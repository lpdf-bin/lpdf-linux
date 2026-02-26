# Tahoe Glass and Performance Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Create consistent rounded UI styling across the app and accelerate heavy PDF workflows through bounded frontend concurrency and parallel backend page processing.

**Architecture:** Use a token-first styling update to enforce one radius system, then optimize the highest-latency frontend and Rust command paths without changing functional behavior. Keep API contracts stable and preserve deterministic output order and validation.

**Tech Stack:** React 19, Vite, Zustand, Tauri v2, Rust, lopdf, qpdf/pdfseparate/pdfunite, Rayon.

---

### Task 1: Unify Radius Tokens

**Files:**
- Modify: `ui/src/styles/tokens.css`
- Test: `ui/src/styles/app.css`

**Step 1: Add shared token**

Set one semantic radius token and map all radius aliases to it.

**Step 2: Add missing spacing token**

Define `--space-5` to eliminate fallback/layout inconsistencies.

**Step 3: Verify style references**

Run: `bun run build`
Expected: CSS compiles with no token errors.

### Task 2: Frontend Concurrency and Render Smoothing

**Files:**
- Modify: `ui/src/components/home/FileOpenPanel.tsx`
- Modify: `ui/src/components/workspace/EditorCanvas.tsx`

**Step 1: Add bounded concurrency mapper**

Implement a reusable `mapWithConcurrency()` helper in `FileOpenPanel.tsx`.

**Step 2: Apply bounded parallel metadata loading**

Use concurrency-limited workers when opening multiple merge sources.

**Step 3: Apply bounded parallel thumbnail loading**

Use concurrency-limited workers for delete-page thumbnail generation.

**Step 4: Cap expensive render DPR**

Clamp editor page `devicePixelRatio` at high zoom to reduce UI stutter.

**Step 5: Verify behavior**

Run: `bun run test`
Expected: Existing tests pass.

### Task 3: Backend Parallelization for Page-Level Work

**Files:**
- Modify: `ui/src-tauri/Cargo.toml`
- Modify: `ui/src-tauri/src/commands/pdf.rs`

**Step 1: Add Rayon dependency**

Add `rayon` in Rust dependencies.

**Step 2: Parallelize `doc_merge_pages` extraction**

Run independent per-page `pdfseparate` jobs concurrently, then merge in deterministic order.

**Step 3: Parallelize watermark per-page processing**

Run overlay/copy page tasks concurrently, then unify ordered outputs.

**Step 4: Preserve error handling and cleanup**

Ensure temp directory cleanup and early-fail behavior remain intact.

**Step 5: Verify Rust build/tests**

Run: `cd ui/src-tauri && cargo test`
Expected: all tests pass.

### Task 4: End-to-End Verification

**Files:**
- Verify only

**Step 1: Full frontend build**

Run: `cd ui && bun run build`
Expected: build succeeds.

**Step 2: Manual smoke test**

Run: `cd ui && bunx tauri dev`
Expected: app launches, rounded consistency visible across Home + workspace, merge/watermark interactions remain stable.
