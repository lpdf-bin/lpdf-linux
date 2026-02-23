# Home (`src/components/home`)

Purpose: launch-time workflows before entering the editor workspace.

## What belongs here

- Home action cards and section layout
- Operation flows: edit, merge, compress, delete, organize, convert-word, protect, unlock, watermark
- Organize-specific sortable panel components

## Boundaries

- Keep IPC wrappers in `src/api/commands.ts`.
- Reuse PDF previews via `src/components/pdf/SharedPdfRendering.tsx`.

## Testing notes

- Update `src/__tests__/uiFlow.test.tsx` for UI flow changes.
- Update `src/__tests__/commands.test.ts` if payloads/contracts change.
