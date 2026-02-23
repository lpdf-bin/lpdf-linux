# Features (`src/features`)

Purpose: feature-scoped logic larger than a single component.

## What belongs here

- Feature-specific orchestration modules
- Feature-level helper hooks or adapters

## Boundaries

- Keep cross-feature utilities in `src/utils`.
- Keep global state concerns in `src/state`.
