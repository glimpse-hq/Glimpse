# Agent guide

## Entry points

- `../AGENTS.md`: repository-wide workflow and product boundaries
- `../src/AGENTS.md`: frontend ownership, queries, events, and window boundaries
- `../src-tauri/AGENTS.md`: Rust ownership, native platforms, and speech integration

Read the scoped guide before editing that subtree, including when your agent starts at the repository root. Keep shared rules here instead of copying them into each guide.

## Rules

- `rules/code.md`: ownership, platforms, privacy, comments
- `rules/ui.md`: copy, layout, color (interface changes)
- `rules/done.md`: checks to run, git, reporting

## Reference by task

Read the matching references, not the whole directory.

| Task                                                                  | Read                                      |
| --------------------------------------------------------------------- | ----------------------------------------- |
| Dictation, audio, model lifecycle, Library jobs, or toasts            | [Architecture](reference/architecture.md) |
| Settings fields, saves, editable drafts, or license gates             | [Settings](reference/settings.md)         |
| App copy, native menu labels, or locales                              | [Localization](reference/i18n.md)         |
| Native windows, permissions, packaging, or platform-specific behavior | [Platforms](reference/platforms.md)       |
| CLI commands, MCP tools, or local HTTP API                            | [Integrations](reference/integrations.md) |
| Removing surprising behavior or changing a product constraint         | [Decisions](reference/decisions.md)       |

## Reusable workflows

- [Localization](skills/localize/SKILL.md): orchestrate low-cost translation and independent review subagents, preserve message contracts, and verify copy in the native app. Use for requested translation or locale review.

## Maintaining this guide

Keep instructions short, actionable, and grounded in the implementation. Add guidance where it prevents a concrete mistake; use links for detail rather than duplicating rules. Keep changing values such as versions and model tags in their manifests. Update paths and commands when their owners move.

Keep root instructions universal, subtree guides focused on their boundaries, and detailed procedures in the references. Do not add an `AGENTS.md` to every feature folder without a distinct rule to put there. Check local Markdown links relative to the file containing them.

`plans/` holds design proposals and history, not current rules. Verify a plan against code before using it.

The layout follows the [AGENTS.md format](https://agents.md/) and [OpenAI's instruction discovery guidance](https://learn.chatgpt.com/docs/agent-configuration/agents-md): broad rules at the root, narrower guidance close to the code, and explicitly linked references.
