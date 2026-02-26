# Commands (`src-tauri/src/commands`)

Purpose: Tauri IPC command handlers and request/response boundaries.

## What belongs here

- `#[tauri::command]` entry points
- Input validation at command boundary
- Mapping into `src/core` helper logic

## Current command inventory (`pdf.rs`)

- `doc_open`
- `doc_get_thumbnail`
- `doc_read_bytes`
- `doc_merge`
- `doc_merge_pages`
- `doc_compress`
- `doc_delete_pages`
- `doc_save`
- `doc_protect_pdf`
- `doc_unlock_pdf`
- `doc_convert_pdf_to_word`
- `doc_convert_pdf_to_excel`
- `doc_convert_pdf_to_ppt`
- `doc_watermark_pdf`

## Boundaries

- Keep heavy logic in `src/core`.
- Update `src/api/commands.ts` and `docs/api/tauri-commands.md` when command contracts change.
