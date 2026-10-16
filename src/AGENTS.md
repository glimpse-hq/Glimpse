# Frontend

Read `../agents/rules/ui.md` for interface changes and `../agents/reference/i18n.md` before changing user-facing strings. Paths below are relative to `src/`.

- `app/App.tsx` routes native window labels. `app/SettingsWindow.tsx` owns the settings window's QueryClient and `QuerySyncBridge`; `Home.tsx` composes its screens. Keep the pill and toast startup paths lightweight.
- Put feature UI, `api.ts` calls, and `queries.ts` hooks in the existing `features/<feature>/` owner. Reuse query keys and invalidation instead of creating another cache or store.
- Prefer existing API boundary files for Tauri calls. Follow `../eslint.config.js` for import boundaries; its legacy exceptions are not a reason to add new cross-feature coupling.
- Shared visual primitives belong in `shared/ui/`; formatting and static metadata belong in `shared/lib/`. Rust owns persistence and domain logic.
- Separate native windows do not share React state or query caches. Coordinate through Rust commands and events. Update the emitter, consumer, and `types/` payload together; dispose event listeners even if registration resolves after unmount. `QuerySyncBridge` is an example.
- Read `../agents/reference/settings.md` before touching settings saves or editable query-backed drafts. Use `features/settings/models-queries.ts` for model catalog queries and labels.
- Onboarding transitions live in `features/onboarding/machine.ts`; preserve its guards and recovery paths when changing steps.
- Use `platform/service.ts` for frontend platform capabilities and backend availability for Apple-only engines. Do not infer engine availability from the OS name alone.

Validation commands and existing frontend tests are listed in `../agents/rules/done.md`.
