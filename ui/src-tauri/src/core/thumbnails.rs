use crate::core::utils::{base_command, resolve_binary_path};
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

pub fn bind_pdfium() -> Result<Box<dyn pdfium_render::prelude::PdfiumLibraryBindings>, String> {
    use pdfium_render::prelude::Pdfium;

    if let Ok(path) = std::env::var("LPDF_PDFIUM_LIB_PATH") {
        if let Ok(bindings) = Pdfium::bind_to_library(path.clone()) {
            return Ok(bindings);
        }
    }

    for candidate in [
        "libpdfium.so",
        "libpdfium.so.1",
        "/usr/lib/libpdfium.so",
        "/usr/lib/libpdfium.so.1",
    ] {
        if let Ok(bindings) = Pdfium::bind_to_library(candidate) {
            return Ok(bindings);
        }
    }

    Pdfium::bind_to_system_library().map_err(|e| {
        format!(
            "Failed to load Pdfium ({e}). Install pdfium or set LPDF_PDFIUM_LIB_PATH to the library file path."
        )
    })
}

pub fn render_thumbnail_with_pdfium(
    path: &str,
    page_index: u32,
    width: u32,
) -> Result<String, String> {
    use image::ImageFormat;
    use pdfium_render::prelude::*;
    use std::io::Cursor;

    let bindings = bind_pdfium()?;
    let pdfium = Pdfium::new(bindings);

    let doc = pdfium
        .load_pdf_from_file(path, None)
        .map_err(|e| e.to_string())?;
    let page = doc
        .pages()
        .get(page_index as u16)
        .map_err(|e| e.to_string())?;

    let render_config = PdfRenderConfig::new().set_target_width(width as i32);
    let bitmap = page
        .render_with_config(&render_config)
        .map_err(|e| e.to_string())?;
    let image = bitmap.as_image();

    let mut buffer = Cursor::new(Vec::new());
    image
        .write_to(&mut buffer, ImageFormat::Png)
        .map_err(|e| e.to_string())?;

    use base64::{engine::general_purpose::STANDARD, Engine as _};
    let b64 = STANDARD.encode(buffer.into_inner());
    Ok(format!("data:image/png;base64,{}", b64))
}

pub fn render_thumbnail_with_pdftoppm(
    path: &str,
    page_index: u32,
    width: u32,
) -> Result<String, String> {
    let pdftoppm_path = resolve_binary_path("pdftoppm")?;
    let tmp_dir = std::env::temp_dir();
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| format!("Time error: {e}"))?
        .as_nanos();
    let nonce = format!("lpdf-thumb-{}-{}-{}", std::process::id(), page_index, nanos);
    let prefix = tmp_dir.join(nonce);
    let page_number = (page_index + 1).to_string();

    let dpi = std::cmp::max(150, (width as f64 / 8.5) as u32);
    let png_path = PathBuf::from(format!("{}.png", prefix.to_string_lossy()));

    let output = base_command(&pdftoppm_path)
        .args([
            "-f",
            &page_number,
            "-l",
            &page_number,
            "-singlefile",
            "-png",
            "-r",
            &dpi.to_string(),
            path,
            &prefix.to_string_lossy(),
        ])
        .output()
        .map_err(|e| format!("Failed to start pdftoppm: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("pdftoppm failed: {}", stderr.trim()));
    }

    let bytes =
        std::fs::read(&png_path).map_err(|e| format!("Failed to read thumbnail output: {e}"))?;
    let _ = std::fs::remove_file(&png_path);

    use base64::{engine::general_purpose::STANDARD, Engine as _};
    let b64 = STANDARD.encode(bytes);
    Ok(format!("data:image/png;base64,{}", b64))
}

pub fn render_thumbnail_with_pdftocairo(
    path: &str,
    page_index: u32,
    width: u32,
) -> Result<String, String> {
    let pdftocairo_path = resolve_binary_path("pdftocairo")?;
    let tmp_dir = std::env::temp_dir();
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| format!("Time error: {e}"))?
        .as_nanos();
    let nonce = format!("lpdf-cairo-{}-{}-{}", std::process::id(), page_index, nanos);
    let prefix = tmp_dir.join(nonce);
    let png_path = PathBuf::from(format!("{}.png", prefix.to_string_lossy()));
    let page_number = (page_index + 1).to_string();

    let output = base_command(&pdftocairo_path)
        .args([
            "-f",
            &page_number,
            "-l",
            &page_number,
            "-singlefile",
            "-png",
            "-scale-to",
            &width.to_string(),
            path,
            &prefix.to_string_lossy(),
        ])
        .output()
        .map_err(|e| format!("Failed to start pdftocairo: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("pdftocairo failed: {}", stderr.trim()));
    }

    let bytes =
        std::fs::read(&png_path).map_err(|e| format!("Failed to read pdftocairo output: {e}"))?;
    let _ = std::fs::remove_file(&png_path);

    use base64::{engine::general_purpose::STANDARD, Engine as _};
    let b64 = STANDARD.encode(bytes);
    Ok(format!("data:image/png;base64,{}", b64))
}
