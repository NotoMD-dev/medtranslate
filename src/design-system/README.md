# MedTranslate Design System

Centralized UI primitives and design tokens for light/dark parity.

- `tokens.css`: base semantic color, spacing, radius, shadow, typography tokens.
- `theme.css`: dark theme overrides driven by `data-theme` on `<html>`.
- `primitives/`: reusable React primitives (layout, cards, buttons, typography, badges, tables, progress, tabs, theme toggle).
- `index.ts`: barrel exports.

## Usage Rules

1. Page components must compose primitives from this directory.
2. Page-level hardcoded color/spacing utility classes are disallowed.
3. Light mode is default; dark mode set by `document.documentElement.dataset.theme`.
4. Theme preference key: `medtranslate-theme`.
