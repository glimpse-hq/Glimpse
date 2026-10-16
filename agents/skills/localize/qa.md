# Localization QA

## Structural checks

Run before and after each batch, replacing the locale and scope file:

```sh
bun agents/skills/localize/scripts/check.mjs fr /absolute/path/to/scope.json
```

The scope is a non-empty JSON array of active PO `msgid` values. An optional third argument selects a temporary target PO copy; English still comes from the repo. The checker is read-only and uses installed Lingui dependencies.

It rejects missing/ambiguous entries, changed explicit-ID markers, empty translations, malformed ICU, changed argument names/types or formatter functions, changed select keys, exact-number cases, and offsets. It warns about English-identical text, missing locale plural categories, fuzzy flags, and changed placeholder counts in messages without selectors. Resolve errors; document why each warning is acceptable or repair it. Record unrelated baseline defects separately.

For messages with selectors, the checker compares sets, not occurrence counts or branch placement. Manually review repeated variables/selectors, formatter styles, rich-text nesting, URLs, whitespace, and meaning. Locale grammar can legitimately change repetition. A passing batch says nothing about untouched entries. If dependency upgrades break the checker, repair or report it, never silently skip validation.

After all writers and reviewers finish:

```sh
bun run lingui:compile
bun run build
git diff --check
```

Compare changes against the saved baseline, including generated JS. Only approved entries should change; preserve pre-existing work. Temporary copies require a separate before/after comparison because repository diffs exclude them. Compilation may use English fallback, so it is not a coverage check. For changed `native.*` entries, also run `cargo check --manifest-path src-tauri/Cargo.toml`.

## Runtime checks

Render changed ICU messages through `@lingui/core` and the compiled target catalog. Explicit PO IDs are runtime IDs; resolve generated IDs with Lingui's formatter.

- Choose the smallest set of values that exercises each reachable plural category, exact-number case, offset, and select branch. Use `Intl.PluralRules` to select values; include fractions only when the source accepts them. Vary independent selectors separately.
- Use realistic long names and mixed-script placeholder values. Verify expected values and grammar, not merely non-empty output or absence of raw braces.
- Render rich text through its actual React `Trans` components to verify links and nesting.

Use temporary smoke fixtures rather than sentence-by-sentence snapshot tests. If modifying the checker, run its regression suite:

```sh
bun --no-install test agents/skills/localize/scripts/check.test.mjs
```

## Native visual checks

Use `bun run tauri dev`, never a standalone frontend server. Inspect changed screens and native menus/toasts for truncation, wrapping, stable layout, disabled/error states, accessibility labels, and light/dark appearance. Check a long locale for shared layout changes. Report layout defects instead of deleting meaning to fit.

For Arabic, inspect punctuation, numbers, and mixed-direction values. Recheck `src/i18n.ts`: it currently forces `dir = "ltr"`, so translated Arabic does not establish RTL support. Report that limitation; do not change layout or insert invisible bidi characters across catalogs in a translation-only task.

If a platform or native app is unavailable, finish mechanical and language checks and explicitly leave visual verification pending. Restore the user's locale after inspection.
