# Screenshots

`scripts/screenshots/run.mjs` takes screenshots of the real native app in the background. Use it to look at screens and to compare before and after a change. Never use computer use, clicks or keystrokes for this: they go to whatever app is in front.

```sh
bun run screenshots -- --scenario walkthrough --out /tmp/shots
bun run screenshots -- --scenario settings --keep --out /tmp/shots
bun run screenshots -- --scenario settings --skip-build --theme dark --out /tmp/shots
bun run screenshots   # README images into assets/readme
```

| Scenario      | Covers                                                                                    |
| ------------- | ----------------------------------------------------------------------------------------- |
| `walkthrough` | Everything below, plus the main screens, release notes and toasts                         |
| `onboarding`  | Every setup step, the FAQ, the license step per license, and failed setup and downloads   |
| `settings`    | Every Settings pane                                                                       |
| `paywall`     | Home and Account for each license, locked screens without one, and the trial-ended screen |
| `readme`      | The four README images (default)                                                          |

Files are numbered in walkthrough order. One run builds once, launches once and takes about 30 seconds for the walkthrough; `--skip-build` reuses the build a `--keep` run left behind, for frontend-only changes; delete `$TMPDIR/glimpse-screenshots-build/` when done. For before and after, run the same command in two checkouts into two folders.

## What it does

- Builds a debug binary with its own identifier, `com.glimpse.screenshots`, and its own dev server port, then moves it to `$TMPDIR/glimpse-screenshots-build/` so nothing runs it from `target/` by mistake. That leaves no `target/debug/Glimpse` (or `glimpse-cli` target) until the next normal build.
- Runs it against copies of your settings and transcription DBs under a fake HOME (macOS) or its own app data folders (Windows), with demo content, links to the installed models, and the license replaced by `glimpse dev license`. The installed app, its data and its socket are never touched.
- Except in `readme`, the sandbox never activates or takes focus: on macOS it runs with the prohibited activation policy, its windows sit behind everything with all but a 40 pt sliver past the right edge of the displays, and WebKit keeps painting them there. It has no tray icon, shortcuts, login item, update checks or license requests (it still reads the public prices), skips model upgrades and warm-up, and refuses to download or delete models. The run logs the frontmost app throughout and fails if the sandbox ever came to the front.
- On macOS, the `readme` scenario activates the sandbox itself for the four captures, so the window chrome renders active, then hides it so macOS gives focus back to the previous app; it never activates any other app. Keystrokes go to the sandbox for those few seconds.
- Captures windows by id (`screencapture -l` on macOS, `window.ps1` on Windows). Windows raises each window topmost, without focus, for its capture; this path is unverified.
- Removes the sandbox afterwards unless `--keep` is passed.

## `glimpse dev`

Debug builds only, and only the sandbox app answers. Use them through the sandbox CLI the script links at `$TMPDIR/glimpse-screenshots/glimpse-cli`, with `GLIMPSE_DEV_SANDBOX=1` and the sandbox HOME, or add a scenario to `run.mjs`.

- `glimpse open <view>` and `glimpse open settings --tab account|general|app|about|models|api`
- `glimpse dev license none|trial|trial-last-day|expired|unlocked-1|unlocked-3`
- `glimpse dev onboarding reset|complete|<step>|download-failed|disk-full|setup-failed|faq|close`
- `glimpse dev show trial-ended|release-notes [--markdown <text>]|toast <milestone|update|no-words|disk-full|ask>|nothing`
- `glimpse dev window <label> info|show|hide|size <w> <h>|position <x> <y>`
- `glimpse dev focus on|off`: macOS only, for `readme`
- `glimpse dev wait-idle [--window <label>]`: fonts, queries, images, lazy screens and animations settled. Animations skip to their last frame in the sandbox.

Not covered: the pill and live view (they need a real recording), and a quit-while-recording prompt (none exists). Outside `readme`, macOS window chrome renders inactive, with grey traffic lights.
