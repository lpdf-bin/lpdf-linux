# Types (`src/types`)

Purpose: shared TypeScript types and interfaces.

## What belongs here

- Reusable domain models used in multiple modules
- Shared command payload/response types when not colocated in API layer

## Boundaries

- Keep one-off component-local props inside that component file.
- Keep types aligned with backend command contracts.
