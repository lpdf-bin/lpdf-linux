# Core (`src-tauri/src/core`)

Purpose: framework-agnostic Rust helpers used by Tauri commands.

## What belongs here

- PDF utilities that do not depend on Tauri runtime types
- Rendering/thumbnail helper flows and command helpers
- Shared process execution helpers

## Boundaries

- Do not define `#[tauri::command]` functions here.
- Keep command signatures and IPC glue in `src/commands`.
