# Settings

## Adding a setting

Rust paths below are relative to `src-tauri/src/`; frontend paths start with `src/`.

Trace an existing setting of the same kind through:

1. `settings.rs`: storage key, `UserSettings` field, default, read, and write.
2. `core/settings.rs`: `UpdateSettingsArgs`, validation, and assignment in `update_settings`.
3. `src/types/settings.ts` and `src/features/settings/useSettingsForm.ts`: response type, draft hydration, save arguments, and the pane's control.
4. Onboarding, `import/apply.rs`, and native menus when they read or write the same setting.

`UpdateSettingsArgs` uses camelCase input; stored settings responses use snake_case. Preserve the existing conversion instead of renaming one side alone. A new independent key can use a read default; renamed keys, changed meanings, and transformed values need explicit compatibility handling.

## The save path

`core/settings.rs::update_settings` takes the whole struct on purpose. It enforces license gates, cross-field rules, launch-at-login rollback, preflight refresh, shortcut registration, and menu updates. Don't split it into per-field commands.

`AppState::persist_settings_with` serializes read-modify-write under the settings lock and returns `prev` and `next`. Reuse the existing owner for narrower mutations such as dictionary updates. Emit changes through `AppState::emit_settings_changed`; `src/app/SettingsWindow.tsx::QuerySyncBridge` updates the frontend cache from `settings:changed`.

The `current_settings` / `current_settings_unmasked` distinction is license masking, not API-key redaction. Do not assume either returns a safe struct to log. `UpdateSettingsResult.shortcut_error` means persistence succeeded but shortcut registration failed; preserve that distinction in the UI.

## License gates

`license.rs::require_license_gate` permits an active trial or purchased license. `require_active_license` requires a purchased license; CLI mutations, MCP, and the local API use this stricter path. Both honor the existing developer bypass. Reuse the guard appropriate to the feature at call time, including background or integration entry points. Do not replace either guard with a frontend boolean or a check made only during setup.

## Draft hydration race

A component that copies query data into local state and writes it back can silently revert edits: a refetch lands mid-edit and the stale value gets saved. Skip hydration while any write is queued or in flight, chain writes, flush on unmount, and restore the edit on failure. `src/features/library/components/LibraryDetail.tsx` (`transcriptPending`, `transcriptSaves`) is the reference.

## Migrations

Upgrades are supported from v0.9.0. Note the source version on every new migration so it can be dated and removed later. Changes to stored shortcut data are high risk: a bad migration reads as "the app stopped working".
