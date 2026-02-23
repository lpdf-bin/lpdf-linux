# lpdf Tauri Backend (`src-tauri`)

Rust backend for native PDF commands and desktop integration.

## Directory Scope

- `src/commands/` - Tauri command handlers (`#[tauri::command]`)
- `src/core/` - pure Rust helpers reused by commands
- `src/error.rs` - application error types and mapping

## External Tools

The backend uses system binaries for PDF operations:

- `pdfunite` and `pdfseparate`
- `pdftoppm` and `pdftocairo`
- `qpdf`
- `ghostscript`
- `libreoffice` (`soffice`) for primary PDF->Word and watermark template conversion
- `pandoc` for PDF->Word fallback pipeline

For cross-platform desktop targets, these tools must be installed and available in system `PATH`.

## Verify

```bash
cargo test
```

## Bundle Targets

Linux bundles are built via Tauri for:

- `deb`
- `rpm`
- `appimage`

These artifacts are published by CI in `.github/workflows/release-linux.yml`.

## Related Docs

- `src/commands/README.md`
- `src/core/README.md`
- `../../docs/api/tauri-commands.md`
