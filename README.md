# lpdf Linux Workspace

Linux-focused implementation for `lpdf`.

## Directory Scope

- `ui/` - desktop frontend shell and tests
- `ui/src-tauri/` - Rust commands and native integration

## Setup

```bash
sudo apt install poppler-utils ghostscript qpdf
cd ui
bun install
bunx tauri dev
```

## Verify

```bash
cd ui
bun run test
bun run build
cd src-tauri && cargo test
```

## Release Output

Linux releases publish:

- `.deb` package
- `.rpm` package
- `.AppImage` fallback binary

Repository metadata for apt/dnf is published to GitHub Pages by CI.

## Related Docs

- `../README.md`
- `ui/README.md`
- `ui/src-tauri/README.md`
- `../docs/development.md`
- `../docs/release.md`
