# Settings

## Adding a setting

Copy the path of an existing setting of the same kind (`start_in_background` is simple): `settings.rs` (key, field, default, read, write), `core/settings.rs` (`UpdateSettingsArgs` and any rule in `update_settings`), `src/types/settings.ts`, `useSettingsForm.ts`, the pane, and onboarding or `import/apply.rs` if relevant. A new key needs no migration; reads fall back to the default.

## The save path

`update_settings` takes the whole struct on purpose. It enforces the license gate, cross-field rules, launch-at-login rollback, and engine and shortcut reloads by comparing `prev` and `next`. Don't split it into per-field commands.

## Draft hydration race

A component that copies query data into local state and writes it back can silently revert edits: a refetch lands mid-edit and the stale value gets saved. Skip hydration while any write is queued or in flight, chain writes, flush on unmount, and restore the edit on failure. `LibraryDetail.tsx` (`transcriptPending`, `transcriptSaves`) is the reference.

## Migrations

Upgrades are supported from v0.9.0. Note the source version on every new migration so it can be dated and removed later. Changes to stored shortcut data are high risk: a bad migration reads as "the app stopped working".
