# Home Layout Consistency Design (Screenshot_30)

## Context

The home/dashboard UI in `FileOpenPanel` is functionally complete but visually inconsistent with target expectations from `Screenshot_30` feedback. The required behavior is:

- Center section headings and card content consistently.
- Keep equal card sizing across action cards.
- Use a strict 3-column desktop layout for the main grids.
- Keep responsive behavior predictable on tablet and mobile.
- Center and normalize Protect/Unlock form layouts after selecting security actions.

No business logic changes are needed for PDF operations.

## Goals

1. Match the requested visual structure without changing command flow.
2. Keep implementation low risk by scoping changes to presentation.
3. Preserve responsiveness and accessibility in existing controls.

## Non-Goals

- No API/command changes in `src/api/commands.ts`.
- No backend/Tauri command changes.
- No changes to organize/merge/delete business rules.

## Chosen Approach

Option B: CSS + light TSX wrappers.

Why this option:

- It delivers the requested layout quickly with limited churn.
- It keeps selectors cleaner than pure CSS overrides.
- It avoids the scope/risk of a full component refactor.

## Design Details

### 1) Grid and Section Layout

- Apply consistent grid behavior for both `Most Popular` and `Security` sections.
- Desktop: strict 3 columns.
- Tablet: 2 columns.
- Mobile: 1 column.
- For `Security`, keep a 3-column track on desktop even with only two cards, leaving one empty track for symmetry.

### 2) Card Sizing and Vertical Alignment

- Keep all cards equal height using shared sizing rules.
- Use `home-card-body` as the growable content region so headings/descriptions align visually across cards with different text lengths.
- Keep CTA buttons pinned near the bottom in all cards.

### 3) Security Sub-Forms

- Add scoped security form wrappers for Protect/Unlock content blocks.
- Center the form container with consistent max width.
- Keep input widths and spacing uniform for single-input (Unlock) and two-input (Protect) variants.
- Keep permissions grid centered and width-capped to avoid left-biased appearance.

### 4) Scope and Safety

- Primary edit target: `src/styles/app.css`.
- Minor structure/class usage in: `src/components/home/FileOpenPanel.tsx`.
- Avoid renaming broad utility classes used outside home panel.

## Testing and Verification

1. Run `bun run test`.
2. Run `bun run build`.
3. Manual smoke checks:
   - Home view shows centered headings and equal cards.
   - Both sections respect `3 -> 2 -> 1` breakpoints.
   - Security section uses 3-column desktop track with two visible cards.
   - Protect/Unlock forms are centered and visually consistent.

## Risks and Mitigations

- Risk: CSS selector bleed into non-home views.
  - Mitigation: scope rules to home panel classes (`.open-panel-box`, `.home-*`, security wrappers).
- Risk: Breakpoint regressions.
  - Mitigation: keep breakpoint rules grouped and explicit for both grids.

## Acceptance Criteria

- Home headings and card content are centered consistently.
- Action cards are visually equal in height in each row.
- Desktop home grids render in 3 columns; tablet in 2; mobile in 1.
- Security desktop section aligns to the same 3-column structure.
- Protect/Unlock panels are centered with consistent spacing and control widths.
