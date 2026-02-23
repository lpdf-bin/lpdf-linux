# Home Layout Consistency Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement consistent home/dashboard layout behavior with strict responsive grid rules, equal card sizing, and centered Protect/Unlock forms.

**Architecture:** Keep behavior logic unchanged and implement presentation updates via scoped CSS plus minimal structural wrappers in `FileOpenPanel`. Add focused UI tests in `uiFlow.test.tsx` that validate class-level structure and security form rendering states. Verify with existing Vitest and build pipelines.

**Tech Stack:** React 19, TypeScript, CSS, Vitest, Vite, Bun

---

### Task 1: Add Failing UI Tests For Layout Contracts

**Files:**
- Modify: `src/__tests__/uiFlow.test.tsx`

**Step 1: Write the failing test for home section grid classes**

```tsx
it("applies dedicated grid classes for popular and security sections", () => {
  const view = renderIntoDocument(<FileOpenPanel />);
  const popularGrid = view.container.querySelector(".home-popular-grid");
  const securityGrid = view.container.querySelector(".home-security-grid");
  expect(popularGrid).not.toBeNull();
  expect(securityGrid).not.toBeNull();
  view.cleanup();
});
```

**Step 2: Write the failing test for centered Protect form wrapper**

```tsx
it("renders protect settings inside centered security form panel", () => {
  const view = renderIntoDocument(<FileOpenPanel />);
  const protectBtn = Array.from(view.container.querySelectorAll("button")).find((btn) =>
    btn.textContent?.includes("Start Protecting"),
  );
  act(() => {
    protectBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  expect(view.container.querySelector(".security-form-panel")).not.toBeNull();
  view.cleanup();
});
```

**Step 3: Run target tests to verify failure**

Run: `bun run test src/__tests__/uiFlow.test.tsx`
Expected: FAIL on missing `.security-form-panel` (and/or missing class wiring if not present).

**Step 4: Keep failing assertions minimal (YAGNI)**

Ensure assertions only check required structural contracts (no pixel/visual assertions).

**Step 5: Commit**

```bash
git add src/__tests__/uiFlow.test.tsx
git commit -m "test: add home layout structure assertions"
```

### Task 2: Add Minimal TSX Structure For Security Forms

**Files:**
- Modify: `src/components/home/FileOpenPanel.tsx`
- Test: `src/__tests__/uiFlow.test.tsx`

**Step 1: Wrap Protect/Unlock settings in a shared panel class**

```tsx
{selectedAction === "protect" && protectDoc ? (
  <div className="delete-pages-panel security-form-panel">
    ...
  </div>
) : null}
```

```tsx
{selectedAction === "unlock" && unlockDoc ? (
  <div className="delete-pages-panel security-form-panel">
    ...
  </div>
) : null}
```

**Step 2: Add consistent input-row classing for security inputs**

```tsx
<div className="delete-pages-input-row security-inputs-row">
  ...
</div>
```

**Step 3: Run target tests**

Run: `bun run test src/__tests__/uiFlow.test.tsx`
Expected: PASS for new structure tests, existing tests remain green.

**Step 4: Refine only if needed for test stability**

Avoid unrelated JSX refactors.

**Step 5: Commit**

```bash
git add src/components/home/FileOpenPanel.tsx src/__tests__/uiFlow.test.tsx
git commit -m "refactor: add security form layout wrappers"
```

### Task 3: Implement Grid/Card/Form Styling Rules

**Files:**
- Modify: `src/styles/app.css`

**Step 1: Enforce strict 3-column desktop grids**

```css
.home-popular-grid,
.home-security-grid {
  grid-template-columns: repeat(3, minmax(220px, 1fr));
}
```

**Step 2: Keep equal card sizing and body alignment**

```css
.home-action-card {
  min-height: 220px;
}

.home-card-body {
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  width: 100%;
}
```

**Step 3: Center security form containers and inputs**

```css
.security-form-panel {
  align-items: center;
}

.security-inputs-row {
  width: 100%;
  max-width: 780px;
  justify-content: center;
}
```

**Step 4: Keep responsive `3 -> 2 -> 1` behavior**

```css
@media (max-width: 1200px) {
  .home-popular-grid,
  .home-security-grid {
    grid-template-columns: repeat(2, minmax(220px, 1fr));
  }
}

@media (max-width: 900px) {
  .home-popular-grid,
  .home-security-grid {
    grid-template-columns: 1fr;
  }
}
```

**Step 5: Commit**

```bash
git add src/styles/app.css
git commit -m "style: normalize home grids and security form alignment"
```

### Task 4: Full Verification And Final Cleanup

**Files:**
- Verify: `src/components/home/FileOpenPanel.tsx`
- Verify: `src/styles/app.css`
- Verify: `src/__tests__/uiFlow.test.tsx`

**Step 1: Run full unit tests**

Run: `bun run test`
Expected: PASS.

**Step 2: Run production build**

Run: `bun run build`
Expected: build succeeds without new warnings/errors.

**Step 3: Manual smoke check in desktop app**

Run: `bunx tauri dev`
Expected: home sections centered, equal card sizing, Security on 3-track desktop, centered Protect/Unlock forms.

**Step 4: Document any deviations**

If visual differences remain, capture exact class/selectors and adjust in a focused follow-up commit.

**Step 5: Commit verification-safe final adjustments**

```bash
git add src/components/home/FileOpenPanel.tsx src/styles/app.css src/__tests__/uiFlow.test.tsx
git commit -m "fix: align home dashboard cards and security forms"
```
