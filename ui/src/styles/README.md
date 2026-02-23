# Styles (`src/styles`)

Purpose: global design tokens and app-wide CSS rules.

## What belongs here

- `tokens.css` for shared variables (spacing, color, radius)
- `app.css` for layout and component-level global styling

## Boundaries

- Keep one-off component CSS out of this layer unless reused broadly.
- Prefer token-driven styling over hard-coded values.
