# State (`src/state`)

Purpose: global Zustand stores for app/editor state.

## What belongs here

- `editorStore.ts` and related state actions/selectors
- Shared state transitions for document/session lifecycle

## Boundaries

- Keep store logic deterministic and testable.
- Keep UI rendering logic in components, not store modules.
