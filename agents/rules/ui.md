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
- Fields inside a Settings card: label above in `ui-text-label-strong`, then an underline input or dropdown `mt-1.5` below it. Dropdowns inside table rows are borderless and transparent.
- A state that swaps content (provider fields vs. a status line) stacks both in one grid cell and hides the inactive one, so the card keeps its height.
- Check light and dark, and one long locale.

## Color

- `cloud` (amber): brand and interactive (toggles, selection, primary actions), warnings.
- `local` (indigo): on-device processing in progress.
- `accent` (purple): system operations (import, updates).
- Where a model runs: a dot with a label, `local` for this computer or a local server, `cloud` for a cloud provider.
- Status text: `ui-color-success` with a check when ready, `ui-color-warning` when something the user turned on can't run yet, muted otherwise.
