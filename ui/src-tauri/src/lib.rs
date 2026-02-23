pub mod commands;
pub mod core;
pub mod error;

use commands::pdf::{
    doc_compress, doc_convert_pdf_to_word, doc_delete_pages, doc_get_thumbnail, doc_merge,
    doc_merge_pages, doc_open, doc_protect_pdf, doc_read_bytes, doc_save, doc_unlock_pdf,
    doc_watermark_pdf,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            doc_open,
            doc_get_thumbnail,
            doc_merge,
            doc_merge_pages,
            doc_compress,
            doc_delete_pages,
            doc_protect_pdf,
            doc_unlock_pdf,
            doc_convert_pdf_to_word,
            doc_watermark_pdf,
            doc_save,
            doc_read_bytes
        ])
        .setup(|_app| {
            if cfg!(debug_assertions) {
                // _app.handle().plugin(
                //   tauri_plugin_log::Builder::default()
                //     .level(log::LevelFilter::Info)
                //     .build(),
                // )?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::commands::pdf::*;

    #[test]
    fn test_doc_open_valid_pdf() {
        let test_pdf_path = "/tmp/test.pdf";
        assert!(
            std::path::Path::new(test_pdf_path).exists(),
            "Download /tmp/test.pdf before running tests"
        );
        let result = doc_open(test_pdf_path.to_string());
        assert!(result.is_ok());
    }

    // Additional tests removed for brevity, check git history for full suite.
}
