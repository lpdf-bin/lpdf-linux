# API (`src/api`)

Purpose: single IPC boundary between React and Rust commands.

## What belongs here

- `commands.ts` wrappers around `@tauri-apps/api/core` `invoke()`
- Request/response typing for command payloads
- Shared error normalization for command failures

## Boundaries

- Do not call `invoke()` directly in UI components.
- Update this layer whenever backend command signatures change.
