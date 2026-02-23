# Hooks (`src/hooks`)

Purpose: shared custom React hooks.

## What belongs here

- Reusable UI and lifecycle hooks
- Hooks with logic shared by multiple features

## Boundaries

- Avoid direct Tauri calls; use `src/api/commands.ts`.
- Add tests for non-trivial behavior.
