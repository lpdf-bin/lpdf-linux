# Utils (`src/utils`)

Purpose: reusable utility functions and shared helpers.

## What belongs here

- Pure transformation helpers
- Parsing and formatting utilities
- Stateless helper logic shared across domains
- Async orchestration helpers (for bounded concurrency)

## Boundaries

- Do not include React/UI rendering logic.
- Do not include direct IPC calls.
