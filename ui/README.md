# lpdf UI (`lpdf-linux/ui`)

Frontend application for the Tauri desktop app.

## Feature Areas

- Home actions: edit, merge, compress, delete pages, organize
- Security actions: protect, unlock, watermark
- Conversion actions: PDF -> Word, PDF -> Excel, PDF -> PowerPoint

## Home Layout Notes

- Home action grids are fixed to 3 columns across desktop/tablet/mobile.
- On narrow screens, sections allow horizontal scroll to preserve readable card widths.

## Stack

- React 19
- Vite
- Bun
- Vitest
- `react-pdf`
- `@dnd-kit/*`

## Run

```bash
bun install
bun run dev
bunx tauri dev
```

## Package Build (Linux)

```bash
bunx tauri build --bundles deb,rpm,appimage
```

## Verify

```bash
bun run test
bun run build
cd src-tauri && cargo test
```

## Directory Guide

- `src/api/` - Tauri IPC wrappers
- `src/components/` - UI surfaces (`home`, `workspace`, `pdf`, `common`)
- `src/state/` - Zustand state store
- `src/styles/` - global CSS and design tokens
- `src/features/`, `src/hooks/`, `src/layouts/` - extension points
- `src/__tests__/` - unit and UI flow tests

## Rules

- Keep `invoke()` calls in `src/api/commands.ts`.
- Keep heavy operations in Rust commands.
- Update tests for every behavior change.

## Related Docs

- `../README.md`
- `src-tauri/README.md`
- `src/components/README.md`
- `src/api/README.md`
- `src/state/README.md`
- `../../docs/release.md`
