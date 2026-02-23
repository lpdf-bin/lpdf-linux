# Workspace (`src/components/workspace`)

Purpose: active PDF editor shell once a document is loaded.

## What belongs here

- `EditorCanvas` and page viewport interactions
- `TopToolbar` and contextual editing controls
- Sidebar/inspector components connected to editor state

## Boundaries

- Keep orchestration tied to `src/state/editorStore.ts`.
- Keep backend command wrappers in `src/api/commands.ts`.
