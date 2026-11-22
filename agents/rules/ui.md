# Interface

## Copy

- Plain and functional, like macOS System Settings. Describe what to do, not what the app does. No selling, no hype.
- Write full, natural sentences. Avoid the clipped fragment-then-punchline cadence (a short phrase, a comma, then one confident word) and stacked fragments; they read as slogans, not as someone talking.
- Warmth is welcome where it fits: a thank-you, a milestone, a finished setup can sound glad. Keep it to one light touch, not enthusiasm on every line.
- No explainer subtitle under a title. Say what to do in the empty state, where it is the only thing on screen.
- No em dashes anywhere (copy, docs, comments, commits).
- App interface strings go through Lingui, including native menu strings declared for extraction. Read `../reference/i18n.md` before changing them; keep CLI protocol output separate from localized app copy.

## Layout

- Nothing shifts when state changes. Reserve space; controls change enabled state instead of appearing or moving.
- Organize by strengthening groups inside a screen, not by adding screens.
- Plain rows with dividers, not cards inside cards.
- Change shared primitives (`src/shared/ui/`, e.g. `ScreenHeader`) rather than restyling one screen.
- One grid for every screen. Titles and header tools sit on the title line, level with the sidebar logo (48px from the top); bottom bars sit on the bottom line (48px from the bottom). Content uses `max-w-column` (reading screens) or `max-w-column-wide` (lists, grids, Settings), and titles, rows and tools start and end on its edges. Scrolling lists use `.column-scroll` so the scrollbar sits in the margin.
- Show each fact once per screen. If a section header, title or path already says it (date, kind, folder), rows and meta lines don't repeat it.
- Where something lives is a path in the title ("Library › Clients"), not a separate control. A list and the item opened from it share the title row, so the path grows in place.
- A header holds at most three tools: search, one primary action, and one ⋯ menu for everything else (copy, export, move, retranscribe, delete).
- On screens whose content is a list to search (Library, an open recording), search is the shared `SearchField`, always visible at the right of the title row. Home is a quiet start page and keeps its magnifier.
- Rows show facts on one line for scanning; cards show content (a preview of the item). A grid that shows what the rows show doesn't earn its place.
- Menus use one style: `ui-surface-menu` with the `FilterMenu` item rows (check on the right for a selection, a hairline between groups).
- Use the `ui-text-*` / `ui-color-*` classes and tokens. No hand-tuned inline type metrics.
- Fields in Settings cards and expanded rows: label above in `ui-text-label-strong`, then an underline input or dropdown `mt-1.5` below it. Dropdowns inside table rows are borderless and transparent.
- Choosing one item from a list: one row per item and a single selected marker. Per-item setup (provider, endpoint, key, model) opens in a dialog from a trailing "Set Up…" or "Edit…" button, and the row title names what is set up. A server or cloud provider sits in its own card above the on-device list (`ProviderCard`: a normal-height row on a soft tint of its kind, no border or mark; the tint never stands in for the Active marker); switching away keeps its setup. Only a choice that actually runs gets the Active marker. Automatic is a mode of the section, a switch beside the section heading, never a row among the models; the model it picks shows Active with "Chosen automatically" in its details, and choosing a model by hand turns it off. Local models sit under a quiet "On this computer" label. Rows share one grid (`ModelRow` is a subgrid): title, state, action. Action columns size to the longest label in any language, labels never wrap, and the title truncates first. One way to pick each thing per screen.
- Dialogs have no shared component; copy the Record naming dialog shell (portal, `bg-black/70` backdrop, `rounded-2xl bg-surface-tertiary p-5 ui-shadow-modal-deep`, `useFocusTrap`, text Cancel, `ui-button-primary`). Add `settings-typescale` when opened from Settings.
- Checkboxes use `shared/ui/Checkbox`, checked in the feature's color.
- Check light and dark, and one long locale.

## Color

- `cloud` (amber): brand and interactive (toggles, selection, primary actions), warnings.
- `local` (indigo): on-device processing in progress.
- `accent` (purple): system operations (import, updates).
- The selected row in a list: `cloud` check and label. A row that can't be chosen says why in muted text; a problem with the selected row shows in its secondary line in `ui-color-warning`.
