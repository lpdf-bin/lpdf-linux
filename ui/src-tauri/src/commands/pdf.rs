use crate::core::thumbnails::{
    render_thumbnail_with_pdfium, render_thumbnail_with_pdftocairo, render_thumbnail_with_pdftoppm,
};
use crate::core::utils::{
    base_command, ensure_docx_extension, ensure_pdf_extension, ensure_pptx_extension,
    ensure_xlsx_extension, resolve_binary_path,
};
use lopdf::{Dictionary, Document, Object};
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::Write;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use std::time::Instant;
use zip::write::SimpleFileOptions;
use zip::ZipArchive;
use zip::ZipWriter;

const IO_BYTES_HIGH: u64 = 800 * 1024 * 1024;
const IO_BYTES_MEDIUM: u64 = 320 * 1024 * 1024;
const IO_BYTES_LOW: u64 = 100 * 1024 * 1024;

#[derive(Clone, Debug)]
struct CachedMeta {
    modified_millis: u128,
    page_count: u32,
    file_size: u64,
}

fn meta_cache() -> &'static Mutex<HashMap<String, CachedMeta>> {
    static META_CACHE: OnceLock<Mutex<HashMap<String, CachedMeta>>> = OnceLock::new();
    META_CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn file_modified_millis(path: &PathBuf) -> Option<u128> {
    let meta = std::fs::metadata(path).ok()?;
    let modified = meta.modified().ok()?;
    let duration = modified.duration_since(std::time::UNIX_EPOCH).ok()?;
    Some(duration.as_millis())
}

fn cache_lookup(path: &str, modified_millis: Option<u128>) -> Option<DocMetaResponse> {
    let modified = modified_millis?;
    let cache = meta_cache().lock().ok()?;
    let entry = cache.get(path)?;
    if entry.modified_millis != modified {
        return None;
    }
    Some(DocMetaResponse {
        page_count: entry.page_count,
        file_size: entry.file_size,
    })
}

fn cache_store(path: String, modified_millis: Option<u128>, page_count: u32, file_size: u64) {
    let Some(modified) = modified_millis else {
        return;
    };
    if let Ok(mut cache) = meta_cache().lock() {
        cache.insert(
            path,
            CachedMeta {
                modified_millis: modified,
                page_count,
                file_size,
            },
        );
    }
}

fn io_parallelism_limit(task_count: usize, estimated_io_bytes: u64) -> usize {
    if task_count <= 1 {
        return 1;
    }
    let available = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(4);

    let io_budget_cap = if estimated_io_bytes >= IO_BYTES_HIGH {
        2
    } else if estimated_io_bytes >= IO_BYTES_MEDIUM {
        3
    } else if estimated_io_bytes >= IO_BYTES_LOW {
        4
    } else {
        6
    };

    std::cmp::min(task_count, std::cmp::min(available, io_budget_cap))
}

fn build_io_pool(task_count: usize, estimated_io_bytes: u64) -> Result<rayon::ThreadPool, String> {
    rayon::ThreadPoolBuilder::new()
        .num_threads(io_parallelism_limit(task_count, estimated_io_bytes))
        .build()
        .map_err(|e| format!("Failed to initialize worker pool: {e}"))
}

fn estimate_merge_input_bytes(input_pages: &[MergePageItem]) -> u64 {
    let mut seen = HashSet::new();
    let mut total = 0u64;
    for item in input_pages {
        if !seen.insert(item.path.clone()) {
            continue;
        }
        if let Ok(meta) = std::fs::metadata(&item.path) {
            total = total.saturating_add(meta.len());
        }
    }
    total
}

fn log_stage(command: &str, stage: &str, started: Instant) {
    println!("[PROFILE] {command}:{stage} took {:?}", started.elapsed());
}

#[derive(Debug, Serialize)]
pub struct OpenDocResponse {
    pub doc_id: String,
    pub page_count: u32,
    pub file_size: u64,
}

#[derive(Debug, Serialize)]
pub struct DocMetaResponse {
    pub page_count: u32,
    pub file_size: u64,
}

#[derive(Debug, Serialize)]
pub struct ThumbnailResponse {
    pub base64_image: String,
}

#[derive(Debug, Serialize)]
pub struct MergePdfResponse {
    pub output_path: String,
    pub input_count: usize,
    pub page_count: u32,
}

#[derive(Debug, Serialize)]
pub struct CompressPdfResponse {
    pub output_path: String,
    pub before_size: u64,
    pub after_size: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MergePageItem {
    pub path: String,
    pub page_number: u32,
}

#[derive(Debug, Serialize)]
pub struct DeletePagesResponse {
    pub output_path: String,
    pub deleted_count: usize,
    pub remaining_pages: u32,
}

#[derive(Debug, Serialize)]
pub struct SaveResponse {
    pub saved_path: String,
    pub annotation_count: usize,
    pub backup_warning: Option<String>,
    pub repair_applied: bool,
    pub repair_warning: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ProtectPdfPermissions {
    pub allow_print: bool,
    pub allow_modify: bool,
    pub allow_extract: bool,
    pub allow_annotate: bool,
    pub allow_form: bool,
    pub allow_assemble: bool,
}

#[derive(Debug, Serialize)]
pub struct ProtectPdfResponse {
    pub output_path: String,
    pub protected: bool,
}

#[derive(Debug, Serialize)]
pub struct ConvertPdfResponse {
    pub output_path: String,
    pub engine: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum WatermarkMode {
    Text,
    Image,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum WatermarkPosition {
    Center,
    TopLeft,
    TopRight,
    BottomLeft,
    BottomRight,
}

#[derive(Debug, Serialize)]
pub struct WatermarkPdfResponse {
    pub output_path: String,
    pub applied_pages: usize,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnnotationPayload {
    #[serde(rename = "type")]
    pub ann_type: String,
    pub text: String,
    pub x: f64,
    pub y: f64,
    pub width: Option<f64>,
    pub height: Option<f64>,
    pub font_size: Option<f64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavePageStatePayload {
    pub page_number: u32,
    pub rotation: i32,
    pub annotations: Vec<AnnotationPayload>,
}

#[tauri::command(rename_all = "camelCase")]
pub fn doc_open(path: String) -> Result<OpenDocResponse, String> {
    let start = Instant::now();
    let p = PathBuf::from(&path);
    let modified_millis = file_modified_millis(&p);

    // B6: 50MB file size guard
    const MAX_FILE_SIZE: u64 = 50 * 1024 * 1024; // 50MB
    let file_size = std::fs::metadata(&p).map(|m| m.len()).unwrap_or(0);
    if file_size > MAX_FILE_SIZE {
        return Err(format!(
            "File too large ({:.1} MB). Maximum supported size is 50 MB.",
            file_size as f64 / (1024.0 * 1024.0)
        ));
    }

    let page_count = if let Some(cached) = cache_lookup(&path, modified_millis) {
        log_stage("doc_open", "cache_hit", start);
        cached.page_count
    } else {
        let load_start = Instant::now();
        let doc = Document::load(&p).map_err(|e| e.to_string())?;
        let count = doc.get_pages().len() as u32;
        log_stage("doc_open", "load_count", load_start);
        cache_store(path.clone(), modified_millis, count, file_size);
        count
    };

    let res = Ok(OpenDocResponse {
        doc_id: path,
        page_count,
        file_size,
    });
    println!("[PROFILE] doc_open took {:?}", start.elapsed());
    res
}

#[tauri::command(rename_all = "camelCase")]
pub fn doc_get_meta(path: String) -> Result<DocMetaResponse, String> {
    let start = Instant::now();
    let p = PathBuf::from(&path);
    let file_size = std::fs::metadata(&p).map(|m| m.len()).unwrap_or(0);
    let modified_millis = file_modified_millis(&p);

    if let Some(cached) = cache_lookup(&path, modified_millis) {
        log_stage("doc_get_meta", "cache_hit", start);
        return Ok(cached);
    }

    let qpdf_stage = Instant::now();
    let page_count = if let Ok(qpdf_path) = resolve_binary_path("qpdf") {
        let output = base_command(&qpdf_path)
            .arg("--show-npages")
            .arg(&path)
            .output()
            .map_err(|e| format!("meta/qpdf: Failed to start qpdf: {e}"))?;

        if output.status.success() {
            let raw = String::from_utf8_lossy(&output.stdout).trim().to_string();
            raw.parse::<u32>()
                .map_err(|e| format!("meta/qpdf: Invalid page count output `{raw}`: {e}"))?
        } else {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            return Err(format!("meta/qpdf: qpdf failed: {stderr}"));
        }
    } else {
        let doc = Document::load(&p).map_err(|e| format!("meta/load: Invalid PDF: {e}"))?;
        doc.get_pages().len() as u32
    };
    log_stage("doc_get_meta", "page_count", qpdf_stage);

    println!(
        "[PROFILE] doc_get_meta total took {:?} (file_size={} bytes)",
        start.elapsed(),
        file_size
    );
    let result = DocMetaResponse {
        page_count,
        file_size,
    };
    cache_store(path, modified_millis, result.page_count, result.file_size);
    Ok(result)
}

#[tauri::command(rename_all = "camelCase")]
pub fn doc_get_thumbnail(
    path: String,
    page_index: u32,
    width: u32,
) -> Result<ThumbnailResponse, String> {
    let start = std::time::Instant::now();
    let pdfium_result = render_thumbnail_with_pdfium(&path, page_index, width);
    if let Ok(image) = &pdfium_result {
        println!(
            "[PROFILE] doc_get_thumbnail (pdfium) for page {} at width {} took {:?}",
            page_index,
            width,
            start.elapsed()
        );
        return Ok(ThumbnailResponse {
            base64_image: image.clone(),
        });
    }

    let pdftoppm_result = render_thumbnail_with_pdftoppm(&path, page_index, width);
    if let Ok(image) = &pdftoppm_result {
        println!(
            "[PROFILE] doc_get_thumbnail (pdftoppm) for page {} at width {} took {:?}",
            page_index,
            width,
            start.elapsed()
        );
        return Ok(ThumbnailResponse {
            base64_image: image.clone(),
        });
    }

    let pdftocairo_result = render_thumbnail_with_pdftocairo(&path, page_index, width);
    if let Ok(image) = &pdftocairo_result {
        return Ok(ThumbnailResponse {
            base64_image: image.clone(),
        });
    }

    Err(format!(
        "Failed to render PDF preview. pdfium: {} | pdftoppm: {} | pdftocairo: {}",
        pdfium_result.err().unwrap_or_else(|| "unknown".to_string()),
        pdftoppm_result
            .err()
            .unwrap_or_else(|| "unknown".to_string()),
        pdftocairo_result
            .err()
            .unwrap_or_else(|| "unknown".to_string()),
    ))
}

#[tauri::command(rename_all = "camelCase")]
pub fn doc_read_bytes(path: String) -> Result<Vec<u8>, String> {
    std::fs::read(&path).map_err(|e| format!("Failed to read file: {e}"))
}

#[tauri::command(rename_all = "camelCase")]
pub fn doc_merge_pages(
    input_pages: Vec<MergePageItem>,
    output_path: String,
) -> Result<MergePdfResponse, String> {
    let start = Instant::now();
    if input_pages.is_empty() {
        return Err("No pages provided for merge".to_string());
    }

    let temp_dir = std::env::temp_dir().join(format!("lpdf_merge_{}", start.elapsed().as_micros()));
    std::fs::create_dir_all(&temp_dir).map_err(|e| e.to_string())?;

    let pdfseparate_path = resolve_binary_path("pdfseparate")?;
    let pdfunite_path = resolve_binary_path("pdfunite")?;
    let output_path = ensure_pdf_extension(&output_path);

    let extracted_files: Vec<String> = input_pages
        .iter()
        .enumerate()
        .map(|(i, _)| {
            temp_dir
                .join(format!("page_{:04}.pdf", i))
                .to_string_lossy()
                .to_string()
        })
        .collect();

    let estimated_io_bytes = estimate_merge_input_bytes(&input_pages);
    let extraction_pool = build_io_pool(input_pages.len(), estimated_io_bytes)?;
    let extraction_start = Instant::now();
    let extraction_results: Vec<Result<(), String>> = extraction_pool.install(|| {
        input_pages
            .par_iter()
            .enumerate()
            .map(|(i, item)| {
                let tmp_file = &extracted_files[i];
                let out = base_command(&pdfseparate_path)
                    .arg("-f")
                    .arg(item.page_number.to_string())
                    .arg("-l")
                    .arg(item.page_number.to_string())
                    .arg(&item.path)
                    .arg(tmp_file)
                    .output()
                    .map_err(|e| e.to_string())?;

                if !out.status.success() {
                    return Err(format!(
                        "Failed to extract page {} from {}: {}",
                        item.page_number,
                        item.path,
                        String::from_utf8_lossy(&out.stderr)
                    ));
                }

                Ok(())
            })
            .collect()
    });
    log_stage("doc_merge_pages", "extract", extraction_start);

    if let Some(err) = extraction_results.into_iter().find_map(Result::err) {
        let _ = std::fs::remove_dir_all(&temp_dir);
        return Err(err);
    }

    let mut cmd = base_command(&pdfunite_path);
    for file in &extracted_files {
        cmd.arg(file);
    }
    cmd.arg(&output_path);

    let unite_start = Instant::now();
    let output = cmd
        .output()
        .map_err(|e| format!("Failed to merge pages: {e}"))?;
    log_stage("doc_merge_pages", "unite", unite_start);

    let _ = std::fs::remove_dir_all(&temp_dir);

    if !output.status.success() {
        return Err(format!(
            "Merge pages failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }

    let page_count = input_pages.len() as u32;

    println!(
        "[PROFILE] doc_merge_pages total took {:?} (pages={}, extract_jobs={})",
        start.elapsed(),
        page_count,
        input_pages.len()
    );
    Ok(MergePdfResponse {
        output_path,
        input_count: input_pages.len(),
        page_count,
    })
}

#[tauri::command(rename_all = "camelCase")]
pub fn doc_merge(
    input_paths: Vec<String>,
    output_path: String,
) -> Result<MergePdfResponse, String> {
    if input_paths.len() < 2 {
        return Err("Select at least two PDF files to merge".to_string());
    }

    let pdfunite_path = resolve_binary_path("pdfunite")?;
    let output_path = ensure_pdf_extension(&output_path);

    let mut cmd = base_command(&pdfunite_path);
    for input in &input_paths {
        cmd.arg(input);
    }
    cmd.arg(&output_path);

    let output = cmd
        .output()
        .map_err(|e| format!("Failed to start pdfunite: {e}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Merge failed: {}", stderr.trim()));
    }

    let merged = Document::load(&output_path).map_err(|e| format!("Merged file invalid: {e}"))?;
    let page_count = merged.get_pages().len() as u32;

    Ok(MergePdfResponse {
        output_path,
        input_count: input_paths.len(),
        page_count,
    })
}

#[tauri::command(rename_all = "camelCase")]
pub fn doc_compress(
    input_path: String,
    output_path: String,
) -> Result<CompressPdfResponse, String> {
    let ps2pdf_path = resolve_binary_path("ps2pdf")?;
    let output_path = ensure_pdf_extension(&output_path);
    Document::load(&input_path).map_err(|e| format!("Input is not a valid PDF: {e}"))?;
    let before_size = std::fs::metadata(&input_path).map(|m| m.len()).unwrap_or(0);

    let output = base_command(&ps2pdf_path)
        .arg(&input_path)
        .arg(&output_path)
        .output()
        .map_err(|e| format!("Failed to start ps2pdf: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Compression failed: {}", stderr.trim()));
    }

    let after_size = std::fs::metadata(&output_path)
        .map(|m| m.len())
        .unwrap_or(0);

    Ok(CompressPdfResponse {
        output_path,
        before_size,
        after_size,
    })
}

#[tauri::command(rename_all = "camelCase")]
pub fn doc_delete_pages(
    input_path: String,
    page_numbers: Vec<u32>,
    output_path: String,
) -> Result<DeletePagesResponse, String> {
    let output_path = ensure_pdf_extension(&output_path);
    let mut doc =
        Document::load(&input_path).map_err(|e| format!("Input is not a valid PDF: {e}"))?;
    let total_pages = doc.get_pages().len() as u32;

    if page_numbers.is_empty() {
        return Err("No pages specified for deletion".to_string());
    }

    let mut filtered: Vec<u32> = page_numbers
        .into_iter()
        .filter(|p| *p >= 1 && *p <= total_pages)
        .collect();
    filtered.sort_unstable();
    filtered.dedup();

    if filtered.is_empty() {
        return Err("Selected pages are outside document page range".to_string());
    }
    if filtered.len() as u32 >= total_pages {
        return Err("Cannot delete all pages from a PDF".to_string());
    }

    doc.delete_pages(&filtered);
    doc.prune_objects();
    doc.compress();
    doc.save(&output_path)
        .map_err(|e| format!("Failed to save output: {e}"))?;

    let remaining_pages = Document::load(&output_path)
        .map_err(|e| format!("Output validation failed: {e}"))?
        .get_pages()
        .len() as u32;

    Ok(DeletePagesResponse {
        output_path,
        deleted_count: filtered.len(),
        remaining_pages,
    })
}

#[tauri::command(rename_all = "camelCase")]
pub fn doc_save(
    path: String,
    page_states: Vec<SavePageStatePayload>,
) -> Result<SaveResponse, String> {
    let save_start = Instant::now();
    let p = PathBuf::from(&path);
    if !p.exists() {
        return Err(format!("File not found: {path}"));
    }

    if page_states.is_empty() {
        return Ok(SaveResponse {
            saved_path: path,
            annotation_count: 0,
            backup_warning: None,
            repair_applied: false,
            repair_warning: None,
        });
    }

    let source_doc = Document::load(&p).map_err(|e| format!("save/load: Invalid PDF: {e}"))?;
    let source_page_count = source_doc.get_pages().len() as u32;

    for state in &page_states {
        if state.page_number == 0 || state.page_number > source_page_count {
            return Err(format!(
                "save/reorder: Invalid page number in editor state: {}",
                state.page_number
            ));
        }
    }

    let tmp_name = format!(
        ".{}.lpdf.tmp",
        p.file_name()
            .and_then(|n| n.to_str())
            .ok_or("Failed to resolve source file name")?
    );
    let temp_path = p.with_file_name(tmp_name);
    let repaired_temp_path = p.with_file_name(format!(
        ".{}.lpdf.repaired.tmp",
        p.file_name()
            .and_then(|n| n.to_str())
            .ok_or("Failed to resolve source file name")?
    ));
    let backup_path = PathBuf::from(format!("{}.bak", p.to_string_lossy()));

    let qpdf_for_reorder = resolve_binary_path("qpdf")
        .map_err(|e| format!("save/reorder: Required command unavailable: {e}"))?;
    let mut reorder_cmd = base_command(&qpdf_for_reorder);
    reorder_cmd
        .arg("--empty")
        .arg("--pages")
        .arg(&path)
        .arg(
            page_states
                .iter()
                .map(|s| s.page_number.to_string())
                .collect::<Vec<_>>()
                .join(","),
        )
        .arg("--")
        .arg(&temp_path);

    let reorder_start = Instant::now();
    let reorder_out = reorder_cmd
        .output()
        .map_err(|e| format!("save/reorder: Failed to start qpdf reorder: {e}"))?;
    log_stage("doc_save", "reorder", reorder_start);
    if !reorder_out.status.success() {
        return Err(format!(
            "save/reorder: qpdf reorder failed: {}",
            String::from_utf8_lossy(&reorder_out.stderr).trim()
        ));
    }

    let mut doc =
        Document::load(&temp_path).map_err(|e| format!("save/load: Invalid reordered PDF: {e}"))?;
    let page_map = doc.get_pages();

    let annotate_start = Instant::now();
    for (idx, state) in page_states.iter().enumerate() {
        let out_page_num = (idx + 1) as u32;
        let page_id = page_map.get(&out_page_num).copied().ok_or_else(|| {
            format!(
                "save/annotate: Missing output page after reorder: {}",
                out_page_num
            )
        })?;

        if state.rotation.rem_euclid(360) != 0 {
            let page_obj = doc
                .get_object_mut(page_id)
                .map_err(|e| format!("save/rotate: Failed to access page {out_page_num}: {e}"))?;
            let page_dict = page_obj
                .as_dict_mut()
                .map_err(|e| format!("save/rotate: Target page is not a dictionary: {e}"))?;
            page_dict.set(
                "Rotate",
                Object::Integer((state.rotation.rem_euclid(360)) as i64),
            );
        }

        for ann in &state.annotations {
            let (page_width, page_height) = page_dimensions(&doc, page_id);
            let ann_x = if ann.x.is_finite() { ann.x } else { 0.0 };
            let ann_y = if ann.y.is_finite() { ann.y } else { 0.0 };
            let ann_w = ann.width.filter(|w| w.is_finite()).unwrap_or(140.0);
            let ann_h = ann.height.filter(|h| h.is_finite()).unwrap_or(36.0);
            let default_w = ann_w.max(24.0);
            let default_h = ann_h.max(18.0);
            let x1 = ann_x.clamp(0.0, page_width.max(1.0));
            let y_top = ann_y.clamp(0.0, page_height.max(1.0));
            let y1 = (page_height - y_top - default_h).clamp(0.0, page_height.max(1.0));
            let x2 = (x1 + default_w).clamp(0.0, page_width.max(1.0));
            let y2 = (y1 + default_h).clamp(0.0, page_height.max(1.0));

            let annot_dict = build_annotation_dict(ann, [x1, y1, x2, y2]);
            let annot_id = doc.new_object_id();
            doc.objects.insert(annot_id, Object::Dictionary(annot_dict));
            attach_annotation_to_page(&mut doc, page_id, annot_id)
                .map_err(|e| format!("save/annotate: {e}"))?;
        }
    }
    log_stage("doc_save", "annotate", annotate_start);

    let write_temp_start = Instant::now();
    doc.save(&temp_path)
        .map_err(|e| format!("save/temp_write: Failed to write temp save file: {e}"))?;
    log_stage("doc_save", "write_temp", write_temp_start);

    let qpdf_path = Some(qpdf_for_reorder.clone());
    let mut candidate_path = temp_path.clone();
    let mut repair_applied = false;
    let mut repair_warning: Option<String> = None;

    let validate_temp_start = Instant::now();
    if let Err(validation_error) = validate_saved_pdf(&temp_path, qpdf_path.as_ref()) {
        log_stage("doc_save", "validate_temp_failed", validate_temp_start);
        let Some(qpdf) = qpdf_path.as_ref() else {
            let _ = std::fs::remove_file(&temp_path);
            return Err(format!(
                "save/validate: {} (qpdf unavailable for repair)",
                validation_error
            ));
        };

        let repair_start = Instant::now();
        let repair_out = base_command(qpdf)
            .arg(&temp_path)
            .arg(&repaired_temp_path)
            .output()
            .map_err(|e| format!("save/repair: Failed to start qpdf repair: {e}"))?;
        log_stage("doc_save", "repair", repair_start);

        if !repair_out.status.success() {
            let _ = std::fs::remove_file(&temp_path);
            return Err(format!(
                "save/repair: Repair failed after validation error ({validation_error}): {}",
                String::from_utf8_lossy(&repair_out.stderr).trim()
            ));
        }

        let validate_repaired_start = Instant::now();
        validate_saved_pdf(&repaired_temp_path, qpdf_path.as_ref())
            .map_err(|e| format!("save/repair: Repaired output validation failed: {e}"))?;
        log_stage("doc_save", "validate_repaired", validate_repaired_start);

        repair_applied = true;
        repair_warning = Some("Saved with structural PDF repair.".to_string());
        candidate_path = repaired_temp_path.clone();
    } else {
        log_stage("doc_save", "validate_temp", validate_temp_start);
    }

    let annotation_count: usize = page_states.iter().map(|p| p.annotations.len()).sum();
    let has_non_zero_rotation = page_states
        .iter()
        .any(|state| state.rotation.rem_euclid(360) != 0);
    let should_attempt_flatten = annotation_count > 0;
    let mut flatten_applied = false;

    if should_attempt_flatten {
        if let Ok(gs_path) = resolve_binary_path("gs") {
            let flattened_temp_path = p.with_file_name(format!(
                ".{}.lpdf.flattened.tmp",
                p.file_name()
                    .and_then(|n| n.to_str())
                    .ok_or("Failed to resolve source file name")?
            ));

            let flatten_start = Instant::now();
            let flatten_out = base_command(&gs_path)
                .arg("-q")
                .arg("-dNOPAUSE")
                .arg("-dBATCH")
                .arg("-sDEVICE=pdfwrite")
                .arg("-dSAFER")
                .arg(format!(
                    "-sOutputFile={}",
                    flattened_temp_path.to_string_lossy()
                ))
                .arg(&candidate_path)
                .output()
                .map_err(|e| format!("save/flatten: Failed to start ghostscript: {e}"))?;
            log_stage("doc_save", "flatten", flatten_start);

            if flatten_out.status.success()
                && validate_saved_pdf(&flattened_temp_path, qpdf_path.as_ref()).is_ok()
            {
                if candidate_path != temp_path && candidate_path != repaired_temp_path {
                    let _ = std::fs::remove_file(&candidate_path);
                }
                candidate_path = flattened_temp_path;
                flatten_applied = true;
            }
        }
    }

    let mut final_validation_required = false;
    if flatten_applied && has_non_zero_rotation {
        let rotate_start = Instant::now();
        apply_rotations_to_pdf(&candidate_path, &page_states)
            .map_err(|e| format!("save/rotate: {e}"))?;
        log_stage("doc_save", "rotate_after_flatten", rotate_start);
        final_validation_required = true;
    }

    if final_validation_required {
        let final_validate_start = Instant::now();
        validate_saved_pdf(&candidate_path, qpdf_path.as_ref())
            .map_err(|e| format!("save/validate: {e}"))?;
        log_stage("doc_save", "final_validate", final_validate_start);
    }

    let backup_start = Instant::now();
    let backup_warning = std::fs::copy(&p, &backup_path)
        .err()
        .map(|e| format!("Backup skipped ({}.bak): {e}", p.to_string_lossy()));
    log_stage("doc_save", "backup", backup_start);

    let replace_start = Instant::now();
    if let Err(rename_error) = std::fs::rename(&candidate_path, &p) {
        std::fs::remove_file(&p).map_err(|e| {
            format!("save/replace: Failed to replace original after temp save: {e}")
        })?;
        std::fs::rename(&candidate_path, &p).map_err(|e| {
            format!("save/replace: Failed to finalize save (rename error: {rename_error}; retry error: {e})")
        })?;
    }
    log_stage("doc_save", "replace", replace_start);

    if temp_path != candidate_path {
        let _ = std::fs::remove_file(&temp_path);
    }
    if repaired_temp_path != candidate_path {
        let _ = std::fs::remove_file(&repaired_temp_path);
    }

    println!(
        "[PROFILE] doc_save total took {:?} (pages={}, annotations={}, flatten_applied={}, repair_applied={}, rotations={})",
        save_start.elapsed(),
        page_states.len(),
        annotation_count,
        flatten_applied,
        repair_applied,
        has_non_zero_rotation
    );

    Ok(SaveResponse {
        saved_path: path,
        annotation_count,
        backup_warning,
        repair_applied,
        repair_warning,
    })
}

fn validate_saved_pdf(path: &PathBuf, qpdf_path: Option<&String>) -> Result<(), String> {
    Document::load(path).map_err(|e| format!("Saved output failed validation: {e}"))?;

    if let Some(qpdf) = qpdf_path {
        let out = base_command(qpdf)
            .arg("--check")
            .arg(path)
            .output()
            .map_err(|e| format!("qpdf check failed to start: {e}"))?;

        if !out.status.success() {
            let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
            let stdout = String::from_utf8_lossy(&out.stdout).trim().to_string();
            let detail = if !stderr.is_empty() { stderr } else { stdout };
            return Err(format!("qpdf check failed: {detail}"));
        }
    }

    Ok(())
}

fn apply_rotations_to_pdf(
    path: &PathBuf,
    page_states: &[SavePageStatePayload],
) -> Result<(), String> {
    let mut doc = Document::load(path)
        .map_err(|e| format!("Failed to load candidate output for rotation pass: {e}"))?;
    let page_map = doc.get_pages();

    for (idx, state) in page_states.iter().enumerate() {
        let page_number = (idx + 1) as u32;
        let Some(page_id) = page_map.get(&page_number).copied() else {
            return Err(format!(
                "Missing page {} while applying rotation",
                page_number
            ));
        };

        let page_obj = doc
            .get_object_mut(page_id)
            .map_err(|e| format!("Failed to access page {}: {e}", page_number))?;
        let page_dict = page_obj
            .as_dict_mut()
            .map_err(|e| format!("Page {} is not a dictionary: {e}", page_number))?;
        let normalized = state.rotation.rem_euclid(360) as i64;
        page_dict.set("Rotate", Object::Integer(normalized));
    }

    doc.save(path)
        .map_err(|e| format!("Failed to persist rotation metadata: {e}"))?;
    Ok(())
}

fn page_dimensions(doc: &Document, page_id: (u32, u16)) -> (f64, f64) {
    if let Ok(obj) = doc.get_object(page_id) {
        if let Ok(dict) = obj.as_dict() {
            if let Ok(media_box) = dict.get(b"MediaBox") {
                if let Ok(arr) = media_box.as_array() {
                    if arr.len() == 4 {
                        let llx = arr[0].as_float().unwrap_or(0.0) as f64;
                        let lly = arr[1].as_float().unwrap_or(0.0) as f64;
                        let urx = arr[2].as_float().unwrap_or(612.0) as f64;
                        let ury = arr[3].as_float().unwrap_or(792.0) as f64;
                        return ((urx - llx).abs().max(1.0), (ury - lly).abs().max(1.0));
                    }
                }
            }
        }
    }
    (612.0, 792.0)
}

fn build_annotation_dict(ann: &AnnotationPayload, rect: [f64; 4]) -> Dictionary {
    let mut dict = Dictionary::new();
    dict.set("Type", Object::Name(b"Annot".to_vec()));
    dict.set(
        "Rect",
        Object::Array(vec![
            Object::Real(rect[0] as f32),
            Object::Real(rect[1] as f32),
            Object::Real(rect[2] as f32),
            Object::Real(rect[3] as f32),
        ]),
    );

    match ann.ann_type.as_str() {
        "link" => {
            dict.set("Subtype", Object::Name(b"Link".to_vec()));
            let mut action = Dictionary::new();
            action.set("S", Object::Name(b"URI".to_vec()));
            action.set("URI", Object::string_literal(ann.text.clone()));
            dict.set("A", Object::Dictionary(action));
            dict.set("Border", Object::Array(vec![0.into(), 0.into(), 1.into()]));
        }
        "whiteout" => {
            dict.set("Subtype", Object::Name(b"Square".to_vec()));
            dict.set("Contents", Object::string_literal("whiteout"));
            dict.set(
                "C",
                Object::Array(vec![
                    Object::Real(1.0_f32),
                    Object::Real(1.0_f32),
                    Object::Real(1.0_f32),
                ]),
            );
            dict.set(
                "IC",
                Object::Array(vec![
                    Object::Real(1.0_f32),
                    Object::Real(1.0_f32),
                    Object::Real(1.0_f32),
                ]),
            );
            dict.set("Border", Object::Array(vec![0.into(), 0.into(), 0.into()]));
        }
        _ => {
            dict.set("Subtype", Object::Name(b"FreeText".to_vec()));
            dict.set("Contents", Object::string_literal(ann.text.clone()));
            dict.set(
                "DA",
                Object::string_literal(format!(
                    "/Helv {} Tf 0 0 0 rg",
                    ann.font_size.unwrap_or(12.0)
                )),
            );
            dict.set("Border", Object::Array(vec![0.into(), 0.into(), 0.into()]));
        }
    }

    dict
}

fn attach_annotation_to_page(
    doc: &mut Document,
    page_id: (u32, u16),
    annot_id: (u32, u16),
) -> Result<(), String> {
    let existing_annots = {
        let page_obj = doc
            .get_object(page_id)
            .map_err(|e| format!("Failed to access target page object: {e}"))?;
        let page_dict = page_obj
            .as_dict()
            .map_err(|e| format!("Target page is not a dictionary: {e}"))?;
        page_dict.get(b"Annots").ok().cloned()
    };

    match existing_annots {
        Some(Object::Reference(arr_ref)) => {
            let arr_obj = doc
                .get_object_mut(arr_ref)
                .map_err(|e| format!("Invalid annots reference: {e}"))?;
            let arr = arr_obj
                .as_array_mut()
                .map_err(|e| format!("Annots reference is not an array: {e}"))?;
            arr.push(Object::Reference(annot_id));
        }
        Some(Object::Array(mut arr)) => {
            arr.push(Object::Reference(annot_id));
            let page_obj = doc
                .get_object_mut(page_id)
                .map_err(|e| format!("Failed to access target page object: {e}"))?;
            let page_dict = page_obj
                .as_dict_mut()
                .map_err(|e| format!("Target page is not a dictionary: {e}"))?;
            page_dict.set("Annots", Object::Array(arr));
        }
        _ => {
            let page_obj = doc
                .get_object_mut(page_id)
                .map_err(|e| format!("Failed to access target page object: {e}"))?;
            let page_dict = page_obj
                .as_dict_mut()
                .map_err(|e| format!("Target page is not a dictionary: {e}"))?;
            page_dict.set("Annots", Object::Array(vec![Object::Reference(annot_id)]));
        }
    }

    Ok(())
}

#[tauri::command(rename_all = "camelCase")]
pub fn doc_protect_pdf(
    input_path: String,
    output_path: String,
    user_password: String,
    owner_password: String,
    permissions: ProtectPdfPermissions,
) -> Result<ProtectPdfResponse, String> {
    if user_password.trim().is_empty() {
        return Err("User password is required".to_string());
    }
    if user_password.len() < 4 {
        return Err("User password must be at least 4 characters".to_string());
    }

    Document::load(&input_path).map_err(|e| format!("Input is not a valid PDF: {e}"))?;

    let qpdf_path = resolve_binary_path("qpdf")?;
    let output_path = ensure_pdf_extension(&output_path);
    let effective_owner_password = if owner_password.trim().is_empty() {
        user_password.clone()
    } else {
        owner_password
    };

    let print_mode = if permissions.allow_print {
        "full"
    } else {
        "none"
    };
    let modify_mode = if permissions.allow_modify {
        "all"
    } else {
        "none"
    };

    let output = base_command(&qpdf_path)
        .arg("--encrypt")
        .arg(&user_password)
        .arg(&effective_owner_password)
        .arg("256")
        .arg(format!("--print={print_mode}"))
        .arg(format!("--modify={modify_mode}"))
        .arg(format!(
            "--extract={}",
            if permissions.allow_extract { "y" } else { "n" }
        ))
        .arg(format!(
            "--annotate={}",
            if permissions.allow_annotate { "y" } else { "n" }
        ))
        .arg(format!(
            "--form={}",
            if permissions.allow_form { "y" } else { "n" }
        ))
        .arg(format!(
            "--assemble={}",
            if permissions.allow_assemble { "y" } else { "n" }
        ))
        .arg("--")
        .arg(&input_path)
        .arg(&output_path)
        .output()
        .map_err(|e| format!("Failed to start qpdf: {e}"))?;

    if !output.status.success() {
        return Err(format!(
            "Protect failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }

    Ok(ProtectPdfResponse {
        output_path,
        protected: true,
    })
}

#[tauri::command(rename_all = "camelCase")]
pub fn doc_unlock_pdf(
    input_path: String,
    output_path: String,
    password: String,
) -> Result<ProtectPdfResponse, String> {
    if password.trim().is_empty() {
        return Err("Password is required to unlock PDF".to_string());
    }

    Document::load(&input_path).map_err(|e| format!("Input is not a valid PDF: {e}"))?;

    let qpdf_path = resolve_binary_path("qpdf")?;
    let output_path = ensure_pdf_extension(&output_path);

    let output = base_command(&qpdf_path)
        .arg(format!("--password={password}"))
        .arg("--decrypt")
        .arg("--")
        .arg(&input_path)
        .arg(&output_path)
        .output()
        .map_err(|e| format!("Failed to start qpdf: {e}"))?;

    if !output.status.success() {
        return Err(format!(
            "Unlock failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }

    Ok(ProtectPdfResponse {
        output_path,
        protected: false,
    })
}

#[tauri::command(rename_all = "camelCase")]
pub fn doc_convert_pdf_to_word(
    input_path: String,
    output_path: String,
) -> Result<ConvertPdfResponse, String> {
    convert_pdf_with_profile(&input_path, &ensure_docx_extension(&output_path), "docx")
}

#[tauri::command(rename_all = "camelCase")]
pub fn doc_convert_pdf_to_excel(
    input_path: String,
    output_path: String,
) -> Result<ConvertPdfResponse, String> {
    convert_pdf_with_profile(&input_path, &ensure_xlsx_extension(&output_path), "xlsx")
}

#[tauri::command(rename_all = "camelCase")]
pub fn doc_convert_pdf_to_ppt(
    input_path: String,
    output_path: String,
) -> Result<ConvertPdfResponse, String> {
    convert_pdf_with_profile(&input_path, &ensure_pptx_extension(&output_path), "pptx")
}

fn convert_pdf_with_profile(
    input_path: &str,
    output_path: &str,
    target_format: &str,
) -> Result<ConvertPdfResponse, String> {
    let total_start = Instant::now();
    Document::load(&input_path).map_err(|e| format!("Input is not a valid PDF: {e}"))?;

    if target_format == "xlsx" {
        let response = fallback_to_xlsx_image_workbook(input_path, output_path)?;
        println!(
            "[PROFILE] doc_convert_pdf total took {:?} (target={}, engine={})",
            total_start.elapsed(),
            target_format,
            response.engine
        );
        return Ok(response);
    }

    let out_path = PathBuf::from(output_path);
    if let Some(parent) = out_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create output directory: {e}"))?;
    }

    let soffice_start = Instant::now();
    let soffice_error = if let Ok(soffice) = resolve_binary_path("soffice") {
        let out_dir = out_path
            .parent()
            .map(PathBuf::from)
            .unwrap_or_else(std::env::temp_dir);

        let soffice_target = match target_format {
            "docx" => "docx:MS Word 2007 XML",
            "xlsx" => "xlsx:Calc MS Excel 2007 XML",
            "pptx" => "pptx:Impress MS PowerPoint 2007 XML",
            _ => target_format,
        };

        let convert_output = base_command(&soffice)
            .arg("--headless")
            .arg("--convert-to")
            .arg(soffice_target)
            .arg("--outdir")
            .arg(&out_dir)
            .arg(input_path)
            .output()
            .map_err(|e| format!("Failed to start LibreOffice: {e}"))?;
        log_stage("doc_convert_pdf", "soffice", soffice_start);

        if convert_output.status.success() {
            let input_stem = PathBuf::from(input_path)
                .file_stem()
                .and_then(|s| s.to_str())
                .ok_or("Failed to resolve input file stem")?
                .to_string();
            let libreoffice_output = out_dir.join(format!("{input_stem}.{target_format}"));
            if libreoffice_output.exists() {
                if libreoffice_output != out_path {
                    fs::copy(&libreoffice_output, &out_path)
                        .map_err(|e| format!("Failed to move converted file: {e}"))?;
                    let _ = fs::remove_file(libreoffice_output);
                }
                if validate_office_output(target_format, output_path).is_ok() {
                    println!(
                        "[PROFILE] doc_convert_pdf total took {:?} (target={}, engine=soffice-fidelity)",
                        total_start.elapsed(),
                        target_format
                    );
                    return Ok(ConvertPdfResponse {
                        output_path: output_path.to_string(),
                        engine: "soffice-fidelity".to_string(),
                    });
                }
                format!(
                    "LibreOffice produced invalid {} output",
                    target_format.to_uppercase()
                )
            } else {
                format!(
                    "LibreOffice completed but {} output file was not produced",
                    target_format.to_uppercase()
                )
            }
        } else {
            format!(
                "LibreOffice conversion failed: {}",
                String::from_utf8_lossy(&convert_output.stderr).trim()
            )
        }
    } else {
        "LibreOffice (`soffice`) is not installed or not in PATH".to_string()
    };

    let fallback_result =
        fallback_image_based_with_pandoc(input_path, output_path, target_format, &soffice_error);

    if let Ok(response) = &fallback_result {
        println!(
            "[PROFILE] doc_convert_pdf total took {:?} (target={}, engine={})",
            total_start.elapsed(),
            target_format,
            response.engine
        );
    }

    fallback_result
}

fn fallback_image_based_with_pandoc(
    input_path: &str,
    output_path: &str,
    target_format: &str,
    soffice_error: &str,
) -> Result<ConvertPdfResponse, String> {
    let pandoc = resolve_binary_path("pandoc").map_err(|err| {
        format!(
            "PDF conversion failed. Primary fidelity engine error: {}. Image fallback unavailable: {}. Install `pandoc`.",
            soffice_error, err
        )
    })?;

    let temp_dir = std::env::temp_dir().join(format!(
        "lpdf_convert_images_{}",
        std::time::Instant::now().elapsed().as_nanos()
    ));
    fs::create_dir_all(&temp_dir)
        .map_err(|e| format!("Failed to create conversion temp dir: {e}"))?;

    let pages = render_pdf_pages_to_png(input_path, &temp_dir)?;
    if pages.is_empty() {
        let _ = fs::remove_dir_all(&temp_dir);
        return Err("Image fallback failed: no rendered pages produced".to_string());
    }

    let markdown = build_image_markdown(&pages, target_format);
    let md_path = temp_dir.join("slides.md");
    fs::write(&md_path, markdown)
        .map_err(|e| format!("Failed to write conversion markdown: {e}"))?;

    let pandoc_stage = Instant::now();
    let mut pandoc_cmd = base_command(&pandoc);
    pandoc_cmd
        .current_dir(&temp_dir)
        .arg(&md_path)
        .arg("--standalone")
        .arg("--resource-path")
        .arg(temp_dir.to_string_lossy().to_string())
        .arg("-o")
        .arg(output_path);
    let pandoc_out = pandoc_cmd
        .output()
        .map_err(|e| format!("Failed to start pandoc: {e}"))?;
    log_stage("doc_convert_pdf", "pandoc_image_fallback", pandoc_stage);

    if !pandoc_out.status.success() {
        let _ = fs::remove_dir_all(&temp_dir);
        return Err(format!(
            "PDF conversion failed. Primary fidelity engine error: {}. Image fallback failed: {}",
            soffice_error,
            String::from_utf8_lossy(&pandoc_out.stderr).trim()
        ));
    }

    validate_office_output(target_format, output_path)
        .map_err(|e| format!("Image fallback produced invalid output: {e}"))?;
    let _ = fs::remove_dir_all(&temp_dir);

    Ok(ConvertPdfResponse {
        output_path: output_path.to_string(),
        engine: "image-fidelity-fallback".to_string(),
    })
}

fn render_pdf_pages_to_png(input_path: &str, temp_dir: &PathBuf) -> Result<Vec<PathBuf>, String> {
    let pdftoppm = resolve_binary_path("pdftoppm")?;
    let prefix = temp_dir.join("page");

    let render_stage = Instant::now();
    let output = base_command(&pdftoppm)
        .arg("-png")
        .arg("-r")
        .arg("220")
        .arg(input_path)
        .arg(&prefix)
        .output()
        .map_err(|e| format!("Failed to start pdftoppm: {e}"))?;
    log_stage("doc_convert_pdf", "render_pages_png", render_stage);

    if !output.status.success() {
        return Err(format!(
            "Failed to render PDF pages for image fallback: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }

    let mut pages = Vec::new();
    for entry in fs::read_dir(temp_dir).map_err(|e| format!("Failed to read temp dir: {e}"))? {
        let entry = entry.map_err(|e| format!("Failed to read temp entry: {e}"))?;
        let path = entry.path();
        let is_png = path
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| e.eq_ignore_ascii_case("png"))
            .unwrap_or(false);
        if !is_png {
            continue;
        }
        let is_page = path
            .file_stem()
            .and_then(|s| s.to_str())
            .map(|name| name.starts_with("page-"))
            .unwrap_or(false);
        if is_page {
            pages.push(path);
        }
    }

    pages.sort_by_key(|path| {
        path.file_stem()
            .and_then(|s| s.to_str())
            .and_then(|name| name.strip_prefix("page-"))
            .and_then(|n| n.parse::<u32>().ok())
            .unwrap_or(0)
    });

    Ok(pages)
}

fn build_image_markdown(image_paths: &[PathBuf], target_format: &str) -> String {
    let mut out = String::new();

    for (idx, image_path) in image_paths.iter().enumerate() {
        let image = image_path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or_default();
        if target_format == "pptx" {
            if idx > 0 {
                out.push_str("\n\n---\n\n");
            }
            out.push_str(&format!("# Page {}\n\n![]({})\n", idx + 1, image));
        } else {
            if idx > 0 {
                out.push_str("\n\n\\newpage\n\n");
            }
            out.push_str(&format!("![]({})\n", image));
        }
    }

    out
}

fn fallback_to_xlsx_image_workbook(
    input_path: &str,
    output_path: &str,
) -> Result<ConvertPdfResponse, String> {
    let temp_dir = std::env::temp_dir().join(format!(
        "lpdf_convert_xlsx_images_{}",
        std::time::Instant::now().elapsed().as_nanos()
    ));
    fs::create_dir_all(&temp_dir)
        .map_err(|e| format!("Failed to create conversion temp dir: {e}"))?;

    let pages = render_pdf_pages_to_png(input_path, &temp_dir)?;
    if pages.is_empty() {
        let _ = fs::remove_dir_all(&temp_dir);
        return Err("Excel image workbook fallback failed: no rendered pages produced".to_string());
    }

    let write_stage = Instant::now();
    let write_result = write_xlsx_with_page_images(output_path, &pages);
    log_stage("doc_convert_pdf", "xlsx_image_writer", write_stage);
    let _ = fs::remove_dir_all(&temp_dir);
    write_result?;

    validate_office_output("xlsx", output_path)
        .map_err(|e| format!("Image workbook produced invalid XLSX output: {e}"))?;

    Ok(ConvertPdfResponse {
        output_path: output_path.to_string(),
        engine: "image-sheet-fidelity".to_string(),
    })
}

fn write_xlsx_with_page_images(output_path: &str, image_paths: &[PathBuf]) -> Result<(), String> {
    let out_file = fs::File::create(output_path)
        .map_err(|e| format!("Failed to create XLSX output file: {e}"))?;
    let mut zip = ZipWriter::new(out_file);
    let options = SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated)
        .unix_permissions(0o644);

    let sheet_count = image_paths.len();

    zip.start_file("[Content_Types].xml", options)
        .map_err(|e| format!("xlsx writer failed: {e}"))?;
    let mut content_types = String::from("<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"><Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/><Default Extension=\"xml\" ContentType=\"application/xml\"/><Default Extension=\"png\" ContentType=\"image/png\"/><Override PartName=\"/xl/workbook.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml\"/><Override PartName=\"/xl/styles.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml\"/>");
    for i in 1..=sheet_count {
        content_types.push_str(&format!("<Override PartName=\"/xl/worksheets/sheet{i}.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml\"/>"));
        content_types.push_str(&format!("<Override PartName=\"/xl/drawings/drawing{i}.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.drawing+xml\"/>"));
    }
    content_types.push_str("</Types>");
    zip.write_all(content_types.as_bytes())
        .map_err(|e| format!("xlsx writer failed: {e}"))?;

    zip.add_directory("_rels/", options)
        .map_err(|e| format!("xlsx writer failed: {e}"))?;
    zip.start_file("_rels/.rels", options)
        .map_err(|e| format!("xlsx writer failed: {e}"))?;
    zip.write_all(br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>"#)
        .map_err(|e| format!("xlsx writer failed: {e}"))?;

    zip.add_directory("xl/", options)
        .map_err(|e| format!("xlsx writer failed: {e}"))?;
    zip.add_directory("xl/_rels/", options)
        .map_err(|e| format!("xlsx writer failed: {e}"))?;
    zip.add_directory("xl/worksheets/", options)
        .map_err(|e| format!("xlsx writer failed: {e}"))?;
    zip.add_directory("xl/worksheets/_rels/", options)
        .map_err(|e| format!("xlsx writer failed: {e}"))?;
    zip.add_directory("xl/drawings/", options)
        .map_err(|e| format!("xlsx writer failed: {e}"))?;
    zip.add_directory("xl/drawings/_rels/", options)
        .map_err(|e| format!("xlsx writer failed: {e}"))?;
    zip.add_directory("xl/media/", options)
        .map_err(|e| format!("xlsx writer failed: {e}"))?;

    zip.start_file("xl/workbook.xml", options)
        .map_err(|e| format!("xlsx writer failed: {e}"))?;
    let mut workbook_xml = String::from("<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><workbook xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\" xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\"><sheets>");
    for i in 1..=sheet_count {
        workbook_xml.push_str(&format!(
            "<sheet name=\"Page {i}\" sheetId=\"{i}\" r:id=\"rId{i}\"/>"
        ));
    }
    workbook_xml.push_str("</sheets></workbook>");
    zip.write_all(workbook_xml.as_bytes())
        .map_err(|e| format!("xlsx writer failed: {e}"))?;

    zip.start_file("xl/_rels/workbook.xml.rels", options)
        .map_err(|e| format!("xlsx writer failed: {e}"))?;
    let mut workbook_rels = String::from("<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">");
    for i in 1..=sheet_count {
        workbook_rels.push_str(&format!("<Relationship Id=\"rId{i}\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet\" Target=\"worksheets/sheet{i}.xml\"/>"));
    }
    workbook_rels.push_str(&format!("<Relationship Id=\"rId{}\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles\" Target=\"styles.xml\"/>", sheet_count + 1));
    workbook_rels.push_str("</Relationships>");
    zip.write_all(workbook_rels.as_bytes())
        .map_err(|e| format!("xlsx writer failed: {e}"))?;

    zip.start_file("xl/styles.xml", options)
        .map_err(|e| format!("xlsx writer failed: {e}"))?;
    zip.write_all(br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="1"><fill><patternFill patternType="none"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs></styleSheet>"#)
        .map_err(|e| format!("xlsx writer failed: {e}"))?;

    for (idx, image_path) in image_paths.iter().enumerate() {
        let sheet_no = idx + 1;
        let image_bytes =
            fs::read(image_path).map_err(|e| format!("Failed to read rendered page image: {e}"))?;
        let image = image::load_from_memory(&image_bytes)
            .map_err(|e| format!("Failed to decode rendered page image: {e}"))?;
        let width_emu = image.width() as u64 * 9525;
        let height_emu = image.height() as u64 * 9525;

        zip.start_file(format!("xl/media/image{sheet_no}.png"), options)
            .map_err(|e| format!("xlsx writer failed: {e}"))?;
        zip.write_all(&image_bytes)
            .map_err(|e| format!("xlsx writer failed: {e}"))?;

        zip.start_file(format!("xl/worksheets/sheet{sheet_no}.xml"), options)
            .map_err(|e| format!("xlsx writer failed: {e}"))?;
        let sheet_xml = format!(
            "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><worksheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\" xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\"><sheetViews><sheetView workbookViewId=\"0\"/></sheetViews><sheetFormatPr defaultRowHeight=\"15\"/><sheetData/><drawing r:id=\"rId1\"/></worksheet>"
        );
        zip.write_all(sheet_xml.as_bytes())
            .map_err(|e| format!("xlsx writer failed: {e}"))?;

        zip.start_file(
            format!("xl/worksheets/_rels/sheet{sheet_no}.xml.rels"),
            options,
        )
        .map_err(|e| format!("xlsx writer failed: {e}"))?;
        zip.write_all(
            format!(
                "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing\" Target=\"../drawings/drawing{sheet_no}.xml\"/></Relationships>"
            )
            .as_bytes(),
        )
        .map_err(|e| format!("xlsx writer failed: {e}"))?;

        zip.start_file(format!("xl/drawings/drawing{sheet_no}.xml"), options)
            .map_err(|e| format!("xlsx writer failed: {e}"))?;
        let drawing_xml = format!(
            "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><xdr:wsDr xmlns:xdr=\"http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing\" xmlns:a=\"http://schemas.openxmlformats.org/drawingml/2006/main\" xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\"><xdr:oneCellAnchor><xdr:from><xdr:col>0</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>0</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:ext cx=\"{width_emu}\" cy=\"{height_emu}\"/><xdr:pic><xdr:nvPicPr><xdr:cNvPr id=\"1\" name=\"Page {sheet_no}\"/><xdr:cNvPicPr/></xdr:nvPicPr><xdr:blipFill><a:blip r:embed=\"rId1\"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:prstGeom prst=\"rect\"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:oneCellAnchor></xdr:wsDr>"
        );
        zip.write_all(drawing_xml.as_bytes())
            .map_err(|e| format!("xlsx writer failed: {e}"))?;

        zip.start_file(
            format!("xl/drawings/_rels/drawing{sheet_no}.xml.rels"),
            options,
        )
        .map_err(|e| format!("xlsx writer failed: {e}"))?;
        zip.write_all(
            format!(
                "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/image\" Target=\"../media/image{sheet_no}.png\"/></Relationships>"
            )
            .as_bytes(),
        )
        .map_err(|e| format!("xlsx writer failed: {e}"))?;
    }

    zip.finish()
        .map_err(|e| format!("xlsx writer failed finishing archive: {e}"))?;
    Ok(())
}

fn validate_office_output(target_format: &str, output_path: &str) -> Result<(), String> {
    let metadata =
        fs::metadata(output_path).map_err(|e| format!("Could not read output metadata: {e}"))?;
    if metadata.len() < 2048 {
        return Err("Output file is unexpectedly small".to_string());
    }

    let file =
        fs::File::open(output_path).map_err(|e| format!("Could not open output file: {e}"))?;
    let mut zip = ZipArchive::new(file)
        .map_err(|e| format!("Output is not a valid Office zip package: {e}"))?;

    match target_format {
        "pptx" => validate_pptx_output(&mut zip),
        "docx" => validate_docx_output(&mut zip),
        "xlsx" => validate_xlsx_output(&mut zip),
        other => Err(format!("Unsupported office output format: {other}")),
    }
}

fn zip_entry_to_string(zip: &mut ZipArchive<fs::File>, name: &str) -> Result<String, String> {
    let mut entry = zip
        .by_name(name)
        .map_err(|_| format!("Missing required package entry: {name}"))?;
    let mut content = String::new();
    std::io::Read::read_to_string(&mut entry, &mut content)
        .map_err(|e| format!("Failed to read package entry {name}: {e}"))?;
    Ok(content)
}

fn validate_pptx_output(zip: &mut ZipArchive<fs::File>) -> Result<(), String> {
    let mut slide_names = Vec::new();
    for i in 0..zip.len() {
        let name = zip
            .by_index(i)
            .map_err(|e| format!("Failed reading package entry: {e}"))?
            .name()
            .to_string();
        if name.starts_with("ppt/slides/slide") && name.ends_with(".xml") {
            slide_names.push(name);
        }
    }
    if slide_names.is_empty() {
        return Err("PPTX contains no slide XML content".to_string());
    }

    let mut content_ok = false;
    for slide in slide_names {
        let xml = zip_entry_to_string(zip, &slide)?;
        if xml.contains("<a:t") || xml.contains("<a:blip") || xml.contains("<p:pic") {
            content_ok = true;
            break;
        }
    }
    if !content_ok {
        return Err("PPTX slides are present but contain no text/image payload".to_string());
    }
    Ok(())
}

fn validate_docx_output(zip: &mut ZipArchive<fs::File>) -> Result<(), String> {
    let xml = zip_entry_to_string(zip, "word/document.xml")?;
    if !xml.contains("<w:body") {
        return Err("DOCX missing document body".to_string());
    }
    if !(xml.contains("<w:t") || xml.contains("<w:drawing") || xml.contains("<w:p")) {
        return Err("DOCX contains no visible paragraph/text/image content".to_string());
    }
    Ok(())
}

fn validate_xlsx_output(zip: &mut ZipArchive<fs::File>) -> Result<(), String> {
    let _ = zip_entry_to_string(zip, "xl/workbook.xml")?;
    let mut sheet_names = Vec::new();
    for i in 0..zip.len() {
        let name = zip
            .by_index(i)
            .map_err(|e| format!("Failed reading package entry: {e}"))?
            .name()
            .to_string();
        if name.starts_with("xl/worksheets/sheet") && name.ends_with(".xml") {
            sheet_names.push(name);
        }
    }
    if sheet_names.is_empty() {
        return Err("XLSX contains no worksheet entries".to_string());
    }
    let mut non_empty = false;
    for sheet in sheet_names {
        let xml = zip_entry_to_string(zip, &sheet)?;
        if xml.contains("<sheetData") {
            non_empty = true;
            break;
        }
    }
    if !non_empty {
        return Err("XLSX worksheets contain no sheetData".to_string());
    }
    Ok(())
}

#[tauri::command(rename_all = "camelCase")]
#[allow(clippy::too_many_arguments)]
pub fn doc_watermark_pdf(
    input_path: String,
    output_path: String,
    mode: WatermarkMode,
    text: Option<String>,
    image_path: Option<String>,
    opacity: f32,
    rotation: f32,
    position: WatermarkPosition,
    scale_percent: u32,
    page_range: Option<String>,
) -> Result<WatermarkPdfResponse, String> {
    let watermark_start = Instant::now();
    let doc = Document::load(&input_path).map_err(|e| format!("Input is not a valid PDF: {e}"))?;
    let total_pages = doc.get_pages().len() as u32;
    let output_path = ensure_pdf_extension(&output_path);

    let pages_to_apply = parse_page_range(page_range.as_deref(), total_pages)?;

    let pdfseparate_path = resolve_binary_path("pdfseparate")?;
    let pdfunite_path = resolve_binary_path("pdfunite")?;
    let qpdf_path = resolve_binary_path("qpdf")?;

    let temp_dir = std::env::temp_dir().join(format!(
        "lpdf_watermark_{}",
        std::time::Instant::now().elapsed().as_micros()
    ));
    fs::create_dir_all(&temp_dir).map_err(|e| format!("Failed to create temp dir: {e}"))?;

    let watermark_pdf = create_watermark_pdf(
        &temp_dir,
        &mode,
        text,
        image_path,
        opacity,
        rotation,
        position,
        scale_percent,
    )?;

    let split_pattern = temp_dir.join("page_%04d.pdf");
    let split_start = Instant::now();
    let split_output = base_command(&pdfseparate_path)
        .arg(&input_path)
        .arg(&split_pattern)
        .output()
        .map_err(|e| format!("Failed to start pdfseparate: {e}"))?;
    log_stage("doc_watermark_pdf", "split", split_start);
    if !split_output.status.success() {
        let _ = fs::remove_dir_all(&temp_dir);
        return Err(format!(
            "Watermark split failed: {}",
            String::from_utf8_lossy(&split_output.stderr).trim()
        ));
    }

    let watermark_estimated_bytes = std::fs::metadata(&input_path)
        .map(|m| m.len())
        .unwrap_or(0)
        .saturating_mul(2);
    let watermark_pool = build_io_pool(total_pages as usize, watermark_estimated_bytes)?;
    let overlay_start = Instant::now();
    let page_results: Vec<Result<(String, bool), String>> = watermark_pool.install(|| {
        (1..=total_pages)
            .into_par_iter()
            .map(|p| {
                let page_file = temp_dir.join(format!("page_{p:04}.pdf"));
                let final_page = temp_dir.join(format!("final_{p:04}.pdf"));
                let apply_here = pages_to_apply
                    .as_ref()
                    .map(|set| set.contains(&p))
                    .unwrap_or(true);

                if apply_here {
                    let overlay_out = base_command(&qpdf_path)
                        .arg("--overlay")
                        .arg(&watermark_pdf)
                        .arg("--repeat=1-z")
                        .arg("--")
                        .arg(&page_file)
                        .arg(&final_page)
                        .output()
                        .map_err(|e| format!("Failed to start qpdf: {e}"))?;
                    if !overlay_out.status.success() {
                        return Err(format!(
                            "Watermark overlay failed on page {p}: {}",
                            String::from_utf8_lossy(&overlay_out.stderr).trim()
                        ));
                    }
                } else {
                    fs::copy(&page_file, &final_page)
                        .map_err(|e| format!("Failed to keep original page {p}: {e}"))?;
                }

                Ok((final_page.to_string_lossy().to_string(), apply_here))
            })
            .collect()
    });
    log_stage("doc_watermark_pdf", "overlay_copy_pages", overlay_start);

    let mut final_pages = Vec::with_capacity(total_pages as usize);
    let mut applied_pages = 0usize;
    for result in page_results {
        match result {
            Ok((page_file, applied)) => {
                final_pages.push(page_file);
                if applied {
                    applied_pages += 1;
                }
            }
            Err(err) => {
                let _ = fs::remove_dir_all(&temp_dir);
                return Err(err);
            }
        }
    }

    let mut unite_cmd = base_command(&pdfunite_path);
    for page_file in &final_pages {
        unite_cmd.arg(page_file);
    }
    unite_cmd.arg(&output_path);

    let unite_start = Instant::now();
    let unite_out = unite_cmd
        .output()
        .map_err(|e| format!("Failed to start pdfunite: {e}"))?;
    log_stage("doc_watermark_pdf", "unite", unite_start);
    let _ = fs::remove_dir_all(&temp_dir);

    if !unite_out.status.success() {
        return Err(format!(
            "Watermark final merge failed: {}",
            String::from_utf8_lossy(&unite_out.stderr).trim()
        ));
    }

    println!(
        "[PROFILE] doc_watermark_pdf total took {:?} (total_pages={}, applied_pages={})",
        watermark_start.elapsed(),
        total_pages,
        applied_pages
    );

    Ok(WatermarkPdfResponse {
        output_path,
        applied_pages,
    })
}

fn parse_page_range(range: Option<&str>, total_pages: u32) -> Result<Option<HashSet<u32>>, String> {
    let Some(raw) = range.map(str::trim).filter(|r| !r.is_empty()) else {
        return Ok(None);
    };

    let mut values = HashSet::new();
    for token in raw.split(',').map(str::trim).filter(|t| !t.is_empty()) {
        if let Some((a, b)) = token.split_once('-') {
            let start = a
                .trim()
                .parse::<u32>()
                .map_err(|_| "Invalid page range format".to_string())?;
            let end = b
                .trim()
                .parse::<u32>()
                .map_err(|_| "Invalid page range format".to_string())?;
            if start == 0 || end == 0 || end < start {
                return Err("Invalid page range values".to_string());
            }
            for p in start..=end {
                if p <= total_pages {
                    values.insert(p);
                }
            }
        } else {
            let p = token
                .parse::<u32>()
                .map_err(|_| "Invalid page number in range".to_string())?;
            if p > 0 && p <= total_pages {
                values.insert(p);
            }
        }
    }

    if values.is_empty() {
        return Err("No valid pages selected from page range".to_string());
    }
    Ok(Some(values))
}

#[allow(clippy::too_many_arguments)]
fn create_watermark_pdf(
    temp_dir: &PathBuf,
    mode: &WatermarkMode,
    text: Option<String>,
    image_path: Option<String>,
    opacity: f32,
    rotation: f32,
    position: WatermarkPosition,
    scale_percent: u32,
) -> Result<PathBuf, String> {
    let soffice = resolve_binary_path("soffice")?;
    let html_path = temp_dir.join("watermark.html");
    let opacity = opacity.clamp(0.05, 1.0);
    let scale = scale_percent.clamp(20, 200);

    let (justify, align) = match position {
        WatermarkPosition::Center => ("center", "center"),
        WatermarkPosition::TopLeft => ("flex-start", "flex-start"),
        WatermarkPosition::TopRight => ("flex-end", "flex-start"),
        WatermarkPosition::BottomLeft => ("flex-start", "flex-end"),
        WatermarkPosition::BottomRight => ("flex-end", "flex-end"),
    };

    let content = match mode {
        WatermarkMode::Text => {
            let raw = text.unwrap_or_else(|| "CONFIDENTIAL".to_string());
            let escaped = raw
                .replace('&', "&amp;")
                .replace('<', "&lt;")
                .replace('>', "&gt;");
            format!(
                "<div style=\"font-size:{}px;font-weight:700;color:#c00000;opacity:{};transform:rotate({}deg);\">{}</div>",
                (48u32.saturating_mul(scale) / 100).max(18),
                opacity,
                rotation,
                escaped
            )
        }
        WatermarkMode::Image => {
            let image = image_path.ok_or("Image watermark selected but no imagePath provided")?;
            if !PathBuf::from(&image).exists() {
                return Err("Selected watermark image does not exist".to_string());
            }
            format!(
                "<img src=\"file://{}\" style=\"max-width:{}%;opacity:{};transform:rotate({}deg);\" />",
                image,
                scale,
                opacity,
                rotation
            )
        }
    };

    let html = format!(
        "<!doctype html><html><body style=\"margin:0;width:100vw;height:100vh;display:flex;justify-content:{};align-items:{};\">{}</body></html>",
        justify, align, content
    );
    fs::write(&html_path, html).map_err(|e| format!("Failed to write watermark template: {e}"))?;

    let out = base_command(&soffice)
        .arg("--headless")
        .arg("--convert-to")
        .arg("pdf")
        .arg("--outdir")
        .arg(temp_dir)
        .arg(&html_path)
        .output()
        .map_err(|e| format!("Failed to start LibreOffice for watermark: {e}"))?;
    if !out.status.success() {
        return Err(format!(
            "Failed to generate watermark PDF: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }

    let watermark_pdf = temp_dir.join("watermark.pdf");
    if !watermark_pdf.exists() {
        return Err("Watermark PDF was not generated".to_string());
    }
    Ok(watermark_pdf)
}

#[cfg(test)]
mod conversion_tests {
    use super::{doc_convert_pdf_to_excel, doc_convert_pdf_to_ppt, doc_convert_pdf_to_word};
    use std::path::{Path, PathBuf};

    fn repo_root() -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .and_then(Path::parent)
            .unwrap_or_else(|| Path::new("."))
            .to_path_buf()
    }

    #[test]
    fn sample_pdf_conversion_quality() {
        let root = repo_root();
        let samples = [
            "drylab.pdf",
            "example.pdf",
            "Presentation Example.pdf",
            "sample-tables.pdf",
        ];

        for sample in samples {
            let input = root.join(sample);
            assert!(input.exists(), "missing sample PDF: {}", input.display());

            let word_output = std::env::temp_dir()
                .join(format!("lpdf-test-{}-word.docx", sample.replace(' ', "_")));
            let word_result = doc_convert_pdf_to_word(
                input.to_string_lossy().to_string(),
                word_output.to_string_lossy().to_string(),
            )
            .expect("word conversion should succeed");
            assert!(
                std::fs::metadata(&word_result.output_path)
                    .map(|m| m.len() > 2048)
                    .unwrap_or(false),
                "word output unexpectedly small for {}",
                sample
            );

            let ppt_output = std::env::temp_dir().join(format!(
                "lpdf-test-{}-slides.pptx",
                sample.replace(' ', "_")
            ));
            let ppt_result = doc_convert_pdf_to_ppt(
                input.to_string_lossy().to_string(),
                ppt_output.to_string_lossy().to_string(),
            )
            .expect("ppt conversion should succeed");
            assert!(
                std::fs::metadata(&ppt_result.output_path)
                    .map(|m| m.len() > 2048)
                    .unwrap_or(false),
                "ppt output unexpectedly small for {}",
                sample
            );

            let xlsx_output = std::env::temp_dir()
                .join(format!("lpdf-test-{}-sheet.xlsx", sample.replace(' ', "_")));
            let xlsx_result = doc_convert_pdf_to_excel(
                input.to_string_lossy().to_string(),
                xlsx_output.to_string_lossy().to_string(),
            )
            .expect("excel conversion should succeed");
            assert!(
                std::fs::metadata(&xlsx_result.output_path)
                    .map(|m| m.len() > 2048)
                    .unwrap_or(false),
                "xlsx output unexpectedly small for {}",
                sample
            );
        }
    }
}
