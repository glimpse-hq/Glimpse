---
name: glimpse-localize
description: Translate or review Glimpse locales with low-cost subagents, contextual copy review, structural checks, and native-app verification. Use for requested localization, not every English copy edit.
---

# Glimpse localization

Use the current chat's agents and local catalogs, not translation APIs or Lokalise synchronization. Follow the repository's git rules. Read `agents/rules/ui.md` and `agents/reference/i18n.md`; run commands from the repository root.

## Coordinate

The current agent orchestrates. Choose the lowest-cost available subagent capable of each translation or review assignment. Give workers fresh, focused context. Keep difficult judgments with the orchestrator. If delegation is unavailable, work sequentially and report that independent review was unavailable.

- One writer per locale catalog. Parallelize different locales within available slots, reserving capacity for review. Batch by screen or feature, roughly 40–80 messages; use smaller batches for complex copy.
- Workers edit only assigned PO entries. Reviewers are read-only. Neither spawns more agents. The orchestrator alone changes shared files and runs extraction, compilation, and builds.
- Each assignment includes locale, allowed file, exact IDs, English source, call sites, placeholder meanings, glossary, and UI constraints. Workers return changed/reviewed IDs and unresolved questions.
- Wait for each writer before reviewing its work. Preserve unrelated edits. If interrupted or usage-limited, record completed and pending batches instead of repeatedly spawning retries.

## Prepare

1. Inspect the working diff and save a temporary baseline of affected catalogs. Use the requested locales, or all non-English locales in `supported-app-locales.json` when none are specified. Do not add locales.
2. If extraction is needed, run `bun run lingui:extract` once before dispatching; inspect its changes. Never use `--clean`. Verify English against the actual source: extraction does not refresh existing explicit-ID `msgstr` values.
3. Parse active entries with `@lingui/format-po`; exclude obsolete `#~` entries. Explicit IDs use English `msgstr` as source; generated IDs use the source message. Resolve mismatches from call sites, never from the ID's wording.
4. Include missing translations, source-changed entries, stale English copies, and requested review IDs. Non-empty translations can be stale. Compare with a known source revision when available; disclose when no reliable comparison exists. English-identical brands or acronyms may be correct.
5. Save batch PO `msgid` values as a temporary JSON array and record their English source. Recheck that source before acceptance if code changed during translation.
6. Read the call sites and neighboring controls. Identify button verbs, titles, state labels, accessibility text, and native menus; explain whether placeholders contain names, counts, or formatted text. Establish a small per-locale glossary from good existing translations before broad work.

## Translate

Use clear, restrained system-UI language: concise actions, natural sentences, and the locale's own casing, punctuation, and formality. Translate meaning rather than English word order. No hype, filler, em dashes, softened destructive actions, or invented claims.

Keep dictation, long-form Recording Mode, transcript, Library, AI Cleanup, and Personalization distinct. Preserve Glimpse/Glimpse Plus, model/provider names, shortcuts, commands, paths, and URLs. Translate descriptive feature labels consistently; capitalization alone does not make a word a brand. Preserve pricing, licensing, trial, quantity, privacy, and permission semantics. Flag ambiguous meaning by ID.

- Edit translations only. Preserve IDs, contexts, comments, references, headers, and unrelated entries. Do not edit generated JS or app code.
- Preserve variable names, numeric placeholders, formatter functions/styles, component tags and nesting, meaningful whitespace, and technical literals. Reorder for grammar without losing values or changing their meaning.
- Keep ICU `other`, exact-number cases, offsets, and `select` keys. Choose plural categories using the target language and `Intl.PluralRules`, not English's one/other pattern. Check escaping through runtime rendering.
- Empty entries are fallback, not completed translations. Do not fill uncertain entries just to claim coverage.

## Review and accept

Assign a separate reviewer the source packet and translations without the writer's rationale. Review every changed entry and plural branch for meaning, idiomatic phrasing, consistency, and UI context. Pay particular attention to licensing, privacy, destructive actions, permissions, and accessibility. Require reviewed IDs and defects with reasons and proposed corrections.

Resolve findings against source behavior, have the writer repair them, and re-review affected entries. Escalate unresolved meaning instead of cycling agents until they agree.

Follow [QA](qa.md): baseline and final structural checks, runtime cases, one compile/build after batches finish, and native visual checks. Compilation and agent agreement alone do not prove quality.

Report scope completed, unresolved IDs, checks run, and surfaces/platforms actually viewed. Distinguish structurally checked from visually verified. Link catalogs and restore the user's locale after UI checks.

## References

- [Lingui translator context](https://lingui.dev/guides/translator-friendly-messages)
- [Lingui ICU syntax](https://lingui.dev/guides/message-format)
- [Apple interface writing](https://developer.apple.com/design/human-interface-guidelines/writing)
