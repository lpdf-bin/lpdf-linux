use crate::core::thumbnails::{
    render_thumbnail_with_pdfium, render_thumbnail_with_pdftocairo, render_thumbnail_with_pdftoppm,
};
use crate::core::utils::{
    base_command, ensure_docx_extension, ensure_pdf_extension, resolve_binary_path,
};
use lopdf::{Dictionary, Document, Object};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Serialize)]
pub struct OpenDocResponse {
    pub doc_id: String,
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
pub struct ConvertPdfToWordResponse {
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
    let start = std::time::Instant::now();
    let p = PathBuf::from(&path);

    // B6: 50MB file size guard
    const MAX_FILE_SIZE: u64 = 50 * 1024 * 1024; // 50MB
    let file_size = std::fs::metadata(&p).map(|m| m.len()).unwrap_or(0);
    if file_size > MAX_FILE_SIZE {
        return Err(format!(
            "File too large ({:.1} MB). Maximum supported size is 50 MB.",
            file_size as f64 / (1024.0 * 1024.0)
        ));
    }

    let doc = Document::load(&p).map_err(|e| e.to_string())?;
    let page_count = doc.get_pages().len() as u32;

    let res = Ok(OpenDocResponse {
        doc_id: path,
        page_count,
        file_size,
    });
    println!("[PROFILE] doc_open took {:?}", start.elapsed());
    res
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
    let start = std::time::Instant::now();
    if input_pages.is_empty() {
        return Err("No pages provided for merge".to_string());
    }

    let temp_dir = std::env::temp_dir().join(format!("lpdf_merge_{}", start.elapsed().as_micros()));
    std::fs::create_dir_all(&temp_dir).map_err(|e| e.to_string())?;

    let pdfseparate_path = resolve_binary_path("pdfseparate")?;
    let pdfunite_path = resolve_binary_path("pdfunite")?;
    let output_path = ensure_pdf_extension(&output_path);

    let mut extracted_files = Vec::new();

    for (i, item) in input_pages.iter().enumerate() {
        let tmp_file = temp_dir.join(format!("page_{:04}.pdf", i));

        let out = base_command(&pdfseparate_path)
            .arg("-f")
            .arg(item.page_number.to_string())
            .arg("-l")
            .arg(item.page_number.to_string())
            .arg(&item.path)
            .arg(&tmp_file)
            .output()
            .map_err(|e| e.to_string())?;

        if !out.status.success() {
            let _ = std::fs::remove_dir_all(&temp_dir);
            return Err(format!(
                "Failed to extract page {} from {}: {}",
                item.page_number,
                item.path,
                String::from_utf8_lossy(&out.stderr)
            ));
        }
        extracted_files.push(tmp_file.to_string_lossy().to_string());
    }

    let mut cmd = base_command(&pdfunite_path);
    for file in &extracted_files {
        cmd.arg(file);
    }
    cmd.arg(&output_path);

    let output = cmd
        .output()
        .map_err(|e| format!("Failed to merge pages: {e}"))?;

    let _ = std::fs::remove_dir_all(&temp_dir);

    if !output.status.success() {
        return Err(format!(
            "Merge pages failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }

    let page_count = input_pages.len() as u32;

    println!("[PROFILE] doc_merge_pages took {:?}", start.elapsed());
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

    let reorder_out = reorder_cmd
        .output()
        .map_err(|e| format!("save/reorder: Failed to start qpdf reorder: {e}"))?;
    if !reorder_out.status.success() {
        return Err(format!(
            "save/reorder: qpdf reorder failed: {}",
            String::from_utf8_lossy(&reorder_out.stderr).trim()
        ));
    }

    let mut doc =
        Document::load(&temp_path).map_err(|e| format!("save/load: Invalid reordered PDF: {e}"))?;
    let page_map = doc.get_pages();

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

    doc.save(&temp_path)
        .map_err(|e| format!("save/temp_write: Failed to write temp save file: {e}"))?;

    let qpdf_path = Some(qpdf_for_reorder.clone());
    let mut candidate_path = temp_path.clone();
    let mut repair_applied = false;
    let mut repair_warning: Option<String> = None;

    if let Err(validation_error) = validate_saved_pdf(&temp_path, qpdf_path.as_ref()) {
        let Some(qpdf) = qpdf_path.as_ref() else {
            let _ = std::fs::remove_file(&temp_path);
            return Err(format!(
                "save/validate: {} (qpdf unavailable for repair)",
                validation_error
            ));
        };

        let repair_out = base_command(qpdf)
            .arg(&temp_path)
            .arg(&repaired_temp_path)
            .output()
            .map_err(|e| format!("save/repair: Failed to start qpdf repair: {e}"))?;

        if !repair_out.status.success() {
            let _ = std::fs::remove_file(&temp_path);
            return Err(format!(
                "save/repair: Repair failed after validation error ({validation_error}): {}",
                String::from_utf8_lossy(&repair_out.stderr).trim()
            ));
        }

        validate_saved_pdf(&repaired_temp_path, qpdf_path.as_ref())
            .map_err(|e| format!("save/repair: Repaired output validation failed: {e}"))?;

        repair_applied = true;
        repair_warning = Some("Saved with structural PDF repair.".to_string());
        candidate_path = repaired_temp_path.clone();
    }

    if let Ok(gs_path) = resolve_binary_path("gs") {
        let flattened_temp_path = p.with_file_name(format!(
            ".{}.lpdf.flattened.tmp",
            p.file_name()
                .and_then(|n| n.to_str())
                .ok_or("Failed to resolve source file name")?
        ));

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

        if flatten_out.status.success()
            && validate_saved_pdf(&flattened_temp_path, qpdf_path.as_ref()).is_ok()
        {
            if candidate_path != temp_path && candidate_path != repaired_temp_path {
                let _ = std::fs::remove_file(&candidate_path);
            }
            candidate_path = flattened_temp_path;
        }
    }

    apply_rotations_to_pdf(&candidate_path, &page_states)
        .map_err(|e| format!("save/rotate: {e}"))?;
    validate_saved_pdf(&candidate_path, qpdf_path.as_ref())
        .map_err(|e| format!("save/validate: {e}"))?;

    let backup_warning = std::fs::copy(&p, &backup_path)
        .err()
        .map(|e| format!("Backup skipped ({}.bak): {e}", p.to_string_lossy()));

    if let Err(rename_error) = std::fs::rename(&candidate_path, &p) {
        std::fs::remove_file(&p).map_err(|e| {
            format!("save/replace: Failed to replace original after temp save: {e}")
        })?;
        std::fs::rename(&candidate_path, &p).map_err(|e| {
            format!("save/replace: Failed to finalize save (rename error: {rename_error}; retry error: {e})")
        })?;
    }

    if temp_path != candidate_path {
        let _ = std::fs::remove_file(&temp_path);
    }
    if repaired_temp_path != candidate_path {
        let _ = std::fs::remove_file(&repaired_temp_path);
    }

    Ok(SaveResponse {
        saved_path: path,
        annotation_count: page_states.iter().map(|p| p.annotations.len()).sum(),
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
) -> Result<ConvertPdfToWordResponse, String> {
    Document::load(&input_path).map_err(|e| format!("Input is not a valid PDF: {e}"))?;

    let output_path = ensure_docx_extension(&output_path);
    let out_path = PathBuf::from(&output_path);
    if let Some(parent) = out_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create output directory: {e}"))?;
    }

    let soffice_error = if let Ok(soffice) = resolve_binary_path("soffice") {
        let out_dir = out_path
            .parent()
            .map(PathBuf::from)
            .unwrap_or_else(std::env::temp_dir);

        let convert_output = base_command(&soffice)
            .arg("--headless")
            .arg("--convert-to")
            .arg("docx")
            .arg("--outdir")
            .arg(&out_dir)
            .arg(&input_path)
            .output()
            .map_err(|e| format!("Failed to start LibreOffice: {e}"))?;

        if convert_output.status.success() {
            let input_stem = PathBuf::from(&input_path)
                .file_stem()
                .and_then(|s| s.to_str())
                .ok_or("Failed to resolve input file stem")?
                .to_string();
            let libreoffice_output = out_dir.join(format!("{input_stem}.docx"));
            if libreoffice_output.exists() {
                if libreoffice_output != out_path {
                    fs::copy(&libreoffice_output, &out_path)
                        .map_err(|e| format!("Failed to move converted file: {e}"))?;
                    let _ = fs::remove_file(libreoffice_output);
                }
                return Ok(ConvertPdfToWordResponse {
                    output_path,
                    engine: "soffice".to_string(),
                });
            }
            "LibreOffice completed but DOCX output file was not produced".to_string()
        } else {
            format!(
                "LibreOffice conversion failed: {}",
                String::from_utf8_lossy(&convert_output.stderr).trim()
            )
        }
    } else {
        "LibreOffice (`soffice`) is not installed or not in PATH".to_string()
    };

    let pdftotext = match resolve_binary_path("pdftotext") {
        Ok(path) => path,
        Err(err) => {
            return Err(format!(
                "PDF->Word conversion failed. Primary engine error: {}. Fallback unavailable: {}",
                soffice_error, err
            ))
        }
    };
    let pandoc = match resolve_binary_path("pandoc") {
        Ok(path) => path,
        Err(err) => {
            return Err(format!(
                "PDF->Word conversion failed. Primary engine error: {}. Fallback unavailable: {}. Install `pandoc` to enable fallback conversion.",
                soffice_error, err
            ))
        }
    };
    let temp_dir = std::env::temp_dir().join(format!(
        "lpdf_convert_{}",
        std::time::Instant::now().elapsed().as_nanos()
    ));
    fs::create_dir_all(&temp_dir).map_err(|e| format!("Failed to create temp dir: {e}"))?;
    let txt_path = temp_dir.join("source.txt");

    let text_extract = base_command(&pdftotext)
        .arg(&input_path)
        .arg(&txt_path)
        .output()
        .map_err(|e| format!("Failed to start pdftotext: {e}"))?;
    if !text_extract.status.success() {
        let _ = fs::remove_dir_all(&temp_dir);
        return Err(format!(
            "PDF->Word conversion failed. Primary engine error: {}. Fallback text extraction failed: {}",
            soffice_error,
            String::from_utf8_lossy(&text_extract.stderr).trim()
        ));
    }

    let pandoc_out = base_command(&pandoc)
        .arg(&txt_path)
        .arg("-o")
        .arg(&output_path)
        .output()
        .map_err(|e| format!("Failed to start pandoc: {e}"))?;
    let _ = fs::remove_dir_all(&temp_dir);

    if !pandoc_out.status.success() {
        return Err(format!(
            "PDF->Word conversion failed. Primary engine error: {}. Pandoc fallback failed: {}",
            soffice_error,
            String::from_utf8_lossy(&pandoc_out.stderr).trim()
        ));
    }

    Ok(ConvertPdfToWordResponse {
        output_path,
        engine: "pandoc-fallback".to_string(),
    })
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
    let split_output = base_command(&pdfseparate_path)
        .arg(&input_path)
        .arg(&split_pattern)
        .output()
        .map_err(|e| format!("Failed to start pdfseparate: {e}"))?;
    if !split_output.status.success() {
        let _ = fs::remove_dir_all(&temp_dir);
        return Err(format!(
            "Watermark split failed: {}",
            String::from_utf8_lossy(&split_output.stderr).trim()
        ));
    }

    let mut final_pages = Vec::new();
    let mut applied_pages = 0usize;

    for p in 1..=total_pages {
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
                let _ = fs::remove_dir_all(&temp_dir);
                return Err(format!(
                    "Watermark overlay failed on page {p}: {}",
                    String::from_utf8_lossy(&overlay_out.stderr).trim()
                ));
            }
            applied_pages += 1;
        } else {
            fs::copy(&page_file, &final_page)
                .map_err(|e| format!("Failed to keep original page {p}: {e}"))?;
        }

        final_pages.push(final_page.to_string_lossy().to_string());
    }

    let mut unite_cmd = base_command(&pdfunite_path);
    for page_file in &final_pages {
        unite_cmd.arg(page_file);
    }
    unite_cmd.arg(&output_path);

    let unite_out = unite_cmd
        .output()
        .map_err(|e| format!("Failed to start pdfunite: {e}"))?;
    let _ = fs::remove_dir_all(&temp_dir);

    if !unite_out.status.success() {
        return Err(format!(
            "Watermark final merge failed: {}",
            String::from_utf8_lossy(&unite_out.stderr).trim()
        ));
    }

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
