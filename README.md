# lpdf

Local-first PDF desktop tooling built with Tauri (Rust backend + React frontend).

`lpdf` is designed for privacy and speed: files stay on your machine and are processed locally.

## Features

- Edit PDF workspace with page previews and annotation tooling
- Merge PDFs (including page-level merge/reorder)
- Organize pages (reorder/remove pages from one file)
- Delete pages
- Compress PDF
- Protect PDF with password and permissions
- Unlock protected PDF with password
- Convert PDF to Word (`.docx`) with fallback engine support
- Add text or image watermark (all pages or selected ranges)

## Repository Layout

- `lpdf-linux/` - active Linux implementation
  - `ui/` - React + Vite + Bun frontend
  - `ui/src-tauri/` - Rust command layer
- `docs/` - architecture, development, and API references

## Quick Start (Linux)

### 1) Install system dependencies

```bash
sudo apt install poppler-utils ghostscript qpdf libreoffice pandoc
```

Optional:

```bash
sudo apt install pdfium
```

### Cross-platform dependency notes

- Linux: `libreoffice` and `pandoc` are installed with `apt`.
- macOS: install with Homebrew (`brew install --cask libreoffice` and `brew install pandoc`).
- Windows: install LibreOffice and Pandoc from official installers and ensure both are in `PATH`.
- Mobile (Android/iOS): system CLI binaries are not reliably available; use a server-side conversion provider for PDF->Word.

### 2) Install app dependencies

```bash
cd lpdf-linux/ui
bun install
```

### 3) Run desktop app

```bash
bunx tauri dev
```

### 4) Verify

```bash
bun run test
bun run build
cd src-tauri && cargo test
```

## Install as End User (Linux)

After a tagged release is published, install with package managers:

- Debian/Ubuntu:

```bash
curl -fsSL https://<owner>.github.io/<repo>/install/setup-apt.sh | bash
```

- Fedora/RHEL:

```bash
curl -fsSL https://<owner>.github.io/<repo>/install/setup-rpm.sh | bash
```

AppImage artifacts are also published for portable fallback installs.

## Documentation

- `docs/architecture.md`
- `docs/development.md`
- `docs/api/tauri-commands.md`
- `docs/release.md`
- `CONTRIBUTING.md`
- `CODE_OF_CONDUCT.md`
- `SECURITY.md`

## Contributing

See `CONTRIBUTING.md` for setup, coding standards, and pull request workflow.

## License

MIT. See `LICENSE`.
