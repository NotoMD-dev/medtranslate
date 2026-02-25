# MedTranslate Design System

This redesign centralizes UI decisions in `src/design-system/`.

## Structure
- `tokens.css`: spacing, radius, semantic colors, typography-facing tokens.
- `theme.css`: dark mode overrides via `[data-theme="dark"]`.
- `primitives/`: reusable React primitives for layout, cards, buttons, badges, typography, table, progress bar, tabs, and theme toggle.
- `index.ts`: barrel exports.

## Theme behavior
- Light mode is default.
- `TabNavigation` owns theme toggling.
- Toggle updates `<html data-theme>` and persists in `localStorage` (`medtranslate-theme`).
- Components read CSS custom properties and transition smoothly during theme changes.

## Usage rules
- Page components should compose primitives only.
- Avoid one-off color and spacing constants in pages.
- Use semantic badge variants for status/warning/danger contexts.
