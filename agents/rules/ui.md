# Interface

## Copy

- Plain and functional, like macOS System Settings. Describe what to do, not what the app does. No selling, no hype.
- Write full, natural sentences. Avoid the clipped fragment-then-punchline cadence (a short phrase, a comma, then one confident word) and stacked fragments; they read as slogans, not as someone talking.
- Warmth is welcome where it fits: a thank-you, a milestone, a finished setup can sound glad. Keep it to one light touch, not enthusiasm on every line.
- No explainer subtitle under a title.
- No em dashes anywhere (copy, docs, comments, commits).
- App interface strings go through Lingui, including native menu strings declared for extraction. Read `../reference/i18n.md` before changing them; keep CLI protocol output separate from localized app copy.

## Layout

- Nothing shifts when state changes. Reserve space; controls change enabled state instead of appearing or moving.
- Organize by strengthening groups inside a screen, not by adding screens.
- Plain rows with dividers, not cards inside cards.
- Change shared primitives (`src/shared/ui/`, e.g. `ScreenHeader`) rather than restyling one screen.
- Use the `ui-text-*` / `ui-color-*` classes and tokens. No hand-tuned inline type metrics.
- Fields in Settings cards and expanded rows: label above in `ui-text-label-strong`, then an underline input or dropdown `mt-1.5` below it. Dropdowns inside table rows are borderless and transparent.
- Choosing one item from a list: one row per item, a single selected marker, and per-item details (endpoint, key, model) under the row behind a disclosure caret. One way to pick each thing per screen.
- Checkboxes use `shared/ui/Checkbox`, checked in the feature's color.
- Check light and dark, and one long locale.

## Color

- `cloud` (amber): brand and interactive (toggles, selection, primary actions), warnings.
- `local` (indigo): on-device processing in progress.
- `accent` (purple): system operations (import, updates).
- The selected row in a list: `cloud` check and label. A row that can't be chosen says why in muted text; a problem with the selected row shows in its secondary line in `ui-color-warning`.
