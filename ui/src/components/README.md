# Components (`src/components`)

Purpose: UI surfaces and reusable visual building blocks.

## What belongs here

- `home/` - landing workflows and action cards
- `workspace/` - active editor shell
- `pdf/` - PDF rendering wrappers
- `common/` - shared UI primitives

## Boundaries

- Do not place Tauri `invoke()` calls directly in components.
- Route backend communication through `src/api/commands.ts`.
