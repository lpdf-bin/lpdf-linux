# Tahoe Glass Theme and Performance Design

## Goal

Deliver a consistent rounded visual language across the full app (including Home), while reducing latency and UI stutter in heavy PDF workflows.

## Approved Direction

- Approach A (token-first): unify visual primitives first, then optimize frontend/backend hot paths.
- Cross-platform behavior: same look and motion model on Linux/macOS/Windows with graceful degradation.
- Phased rollout: visual consistency, then performance and concurrency improvements.

## Key Design Decisions

1. **Unified radius system**
   - All primary surfaces and controls use a single semantic radius token.
   - Existing radius aliases (`--radius-xs/sm/md/lg/control`) map to one value.

2. **Frontend performance constraints**
   - Keep render quality high, but cap expensive render scaling at high zoom.
   - Avoid giant unbounded fan-out calls for metadata and thumbnails.

3. **Backend concurrency model**
   - Split/overlay/extract jobs run concurrently where page work is independent.
   - Preserve deterministic output ordering and current validation guarantees.

## Risks and Mitigations

- **Risk:** Parallel command execution causes unstable ordering.
  - **Mitigation:** Use deterministic temporary file naming and ordered merge input assembly.
- **Risk:** Visual change feels too abrupt.
  - **Mitigation:** Keep one token-based radius source of truth, no ad-hoc per-component overrides.
- **Risk:** GPU pressure at high zoom.
  - **Mitigation:** Clamp effective render DPR.

## Verification

1. `bun run test`
2. `bun run build`
3. `cd src-tauri && cargo test`
4. Manual smoke checks for Home cards, toolbars, sidebars, modals, and heavy merge/watermark flows.
