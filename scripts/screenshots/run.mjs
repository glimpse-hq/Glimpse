#!/usr/bin/env bun
// Screenshots of the real app from demo data, taken in the background. See
// agents/reference/screenshots.md.
//
// A debug build with its own identifier (com.glimpse.screenshots) runs against
// a throwaway data directory: a fake HOME on macOS, its own app data folders on
// Windows. It reads a copy of your settings (models, shortcuts) but sees only
// the demo content below, never quits or talks to the installed Glimpse, and
// never activates, so the app you're using keeps focus. `glimpse dev` commands
// switch license, setup and overlay state in one launch.
//
//   bun run screenshots                                   # README shots into assets/readme
//   bun run screenshots -- --scenario walkthrough --out /tmp/shots
//   bun run screenshots -- --scenario settings --theme dark --skip-build --keep
//
// Scenarios: readme, walkthrough, onboarding, settings, paywall.
// macOS needs Screen Recording access for the terminal (screencapture).
// Windows needs an interactive desktop session, and a shell where `cargo build`
// works unless you pass --skip-build.

import { Database } from "bun:sqlite";
import {
  copyFileSync,
  cpSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const IS_WINDOWS = process.platform === "win32";
const IDENTIFIER = (
  await Bun.file(join(ROOT, "src-tauri/tauri.conf.json")).json()
).identifier;
// The sandbox build's own identifier: its own data directory, webview
// storage, single-instance lock and CLI socket.
const DEMO_IDENTIFIER = "com.glimpse.screenshots";
// Its own dev server port, so it never loads another checkout's frontend.
const VITE_PORT = 8745;
const TARGET_DIR =
  process.env.CARGO_TARGET_DIR ?? join(ROOT, "src-tauri/target");
const BUILT_BINARY = join(
  TARGET_DIR,
  IS_WINDOWS ? "debug/Glimpse.exe" : "debug/Glimpse",
);
// The sandbox build moves here, so nothing else runs it from the target dir
// by mistake. Kept with --keep, for a later --skip-build.
const SANDBOX_BUILD = join(
  tmpdir(),
  "glimpse-screenshots-build",
  IS_WINDOWS ? "Glimpse.exe" : "Glimpse",
);
const WINDOW = IS_WINDOWS
  ? { x: 80, y: 60, width: 1100, height: 820 }
  : { width: 900, height: 750 };

// ---------------------------------------------------------------------------
// Demo content. Edit freely; nothing here is read from your real data.
// ---------------------------------------------------------------------------

const TRANSCRIPTIONS = [
  "Hey, people reading this picture.",
  "This is Glimpse.",
  "It's fast, open source, runs right on your computer, and it's pretty awesome.",
  "How much wood could a woodchuck chuck if a woodchuck could chuck wood?",
  "Which came first, the chicken or the egg?",
  "What other placeholder text can I say to fill this screen and give people reading this a great example?",
  "Remind me to water the plants before the weekend and pick up coffee beans on the way home.",
];

// Shown in the account pill instead of the license holder's name.
const ACCOUNT_NAME = "User";

const DICTIONARY = ["Groq", "Tauri", "Electrobun"];

const REPLACEMENTS = [{ from: "my email", to: "example@test.com" }];

const PERSONALITIES = [
  {
    id: "demo-messaging",
    name: "Messaging",
    enabled: true,
    apps: IS_WINDOWS
      ? ["Slack", "Microsoft Teams", "WhatsApp"]
      : ["Messages", "Slack", "Calendar"],
    websites: ["slack.com", "reddit.com", "tryglimpse.cc"],
    instructions: [
      "Write semi-casual, friendly, as if you're messaging a colleague.",
      "Keep it to a couple of sentences.",
    ],
  },
  {
    id: "demo-email",
    name: "Email",
    enabled: true,
    apps: IS_WINDOWS
      ? ["Outlook", "Mail", "Thunderbird"]
      : ["Mail", "Outlook", "Spark"],
    websites: ["mail.google.com", "outlook.com", "mail.yahoo.com"],
    instructions: [
      "Write in correct email semi-formal, friendly, form.",
      "Open with a greeting and close with a sign-off.",
    ],
  },
  {
    id: "demo-notes",
    name: "Notes",
    enabled: true,
    apps: IS_WINDOWS
      ? ["Notion", "Obsidian", "OneNote"]
      : ["Notes", "Notion", "Obsidian", "Bear", "Craft"],
    websites: ["notion.so", "craft.do", "affine.pro", "bear.app"],
    instructions: [
      "Distill into a concise, scannable format based on what was said.",
      "Use short bullet points.",
    ],
  },
  {
    id: "demo-coding",
    name: "Coding",
    enabled: true,
    apps: IS_WINDOWS
      ? ["Cursor", "Visual Studio Code", "Visual Studio", "Windows Terminal"]
      : ["Cursor", "Visual Studio Code", "Xcode", "Zed", "Terminal"],
    websites: ["github.com", "gitlab.com", "bitbucket.org"],
    instructions: [
      "Treat technical keywords, library names, and log output literally.",
      "Prefer code-style formatting for identifiers.",
    ],
  },
];

const LIBRARY_ITEMS = [
  {
    name: "Script reading",
    status: "complete",
    progress: 1,
    duration: 56,
    size: 1_900_000_000,
    format: "mov",
    transcript:
      "Scene one. Interior, kitchen, morning. She pours the coffee and looks out of the window.",
  },
  {
    name: "Podcast",
    status: "complete",
    progress: 1,
    duration: 265,
    size: 8_300_000,
    format: "mp3",
    transcript:
      "Welcome back to the show. Today we are talking about how people actually use dictation at work.",
  },
];

// Settings for another dictation app, so setup offers its import step (macOS).
const HANDY_SETTINGS = {
  settings: {
    custom_words: ["Glimpse", "Tauri", "Groq"],
    bindings: { transcribe: { current_binding: "option+space" } },
  },
};

// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const index = args.indexOf(name);
  return index === -1 ? fallback : (args[index + 1] ?? fallback);
};
const has = (name) => args.includes(name);

const SCENARIO = flag("--scenario", "readme");
const OUT_DIR = resolve(
  flag(
    "--out",
    SCENARIO === "readme"
      ? join(ROOT, "assets/readme")
      : join(tmpdir(), "glimpse-shots", SCENARIO),
  ),
);
const THEME = flag("--theme", "light");
const SKIP_BUILD = has("--skip-build");
const KEEP = has("--keep");

if (!["darwin", "win32"].includes(process.platform)) {
  console.error("The screenshot script runs on macOS and Windows.");
  process.exit(1);
}

const started = Date.now();
const elapsed = () => `${((Date.now() - started) / 1000).toFixed(1)}s`;
const log = (message) => console.log(`• ${elapsed()} ${message}`);
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

const run = async (cmd, options = {}) => {
  const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe", ...options });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const code = await proc.exited;
  return { code, stdout: stdout.trim(), stderr: stderr.trim() };
};

// --- sandbox ---------------------------------------------------------------

const realHome = homedir();
const sandboxRoot = join(tmpdir(), "glimpse-screenshots");
const sandboxHome = join(sandboxRoot, "home");
const realData = IS_WINDOWS
  ? join(process.env.APPDATA, IDENTIFIER)
  : join(realHome, "Library/Application Support", IDENTIFIER);
const sandboxData = IS_WINDOWS
  ? join(process.env.APPDATA, DEMO_IDENTIFIER)
  : join(sandboxHome, "Library/Application Support", DEMO_IDENTIFIER);
// WebView2 keeps its storage under LOCALAPPDATA.
const sandboxLocal = IS_WINDOWS
  ? join(process.env.LOCALAPPDATA, DEMO_IDENTIFIER)
  : null;
// A bundle gives the sandbox its own WebKit storage and preferences, which
// macOS keeps in the real home whatever HOME says.
const bundle = join(sandboxRoot, "Glimpse Sandbox.app");
const appBinary = IS_WINDOWS
  ? join(sandboxRoot, "Glimpse.exe")
  : join(bundle, "Contents/MacOS/Glimpse");
const cli = IS_WINDOWS ? appBinary : join(sandboxRoot, "glimpse-cli");
const realHomeLeftovers = IS_WINDOWS
  ? []
  : [
      "Library/WebKit",
      "Library/Caches",
      "Library/HTTPStorages",
      "Library/Saved Application State",
      "Library/Preferences",
    ].flatMap((dir) =>
      [
        DEMO_IDENTIFIER,
        `${DEMO_IDENTIFIER}.binarycookies`,
        `${DEMO_IDENTIFIER}.savedState`,
        `${DEMO_IDENTIFIER}.plist`,
      ].map((name) => join(realHome, dir, name)),
    );
const sandboxEnv = {
  ...process.env,
  GLIMPSE_DEV_SANDBOX: "1",
  ...(IS_WINDOWS ? {} : { HOME: sandboxHome }),
};
// On Windows the same exe acts as the CLI when GLIMPSE_CLI_SHIM is set.
const cliEnv = IS_WINDOWS
  ? { ...sandboxEnv, GLIMPSE_CLI_SHIM: "1" }
  : sandboxEnv;
const runCli = (cliArgs) => run([cli, ...cliArgs], { env: cliEnv });

const nowMs = Date.now();
const nowIso = new Date(nowMs).toISOString();

const sqliteBackup = (from, to) => {
  const db = new Database(from, { readonly: true });
  db.run("VACUUM INTO ?", [to]);
  db.close();
};

// A valid 16 kHz mono WAV of silence, so library rows point at a real file.
const silentWav = (seconds) => {
  const samples = 16_000 * seconds;
  const data = samples * 2;
  const buffer = Buffer.alloc(44 + data);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + data, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(16_000, 24);
  buffer.writeUInt32LE(32_000, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(data, 40);
  return buffer;
};

const seedSettings = (path, { onboarded }) => {
  const db = new Database(path);
  const set = db.prepare(
    "INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  );
  const json = (value) => JSON.stringify(value);
  set.run("dictionary", json(DICTIONARY));
  set.run("replacements", json(REPLACEMENTS));
  set.run("personalities", json(PERSONALITIES));
  set.run("personalities_notes_seeded", "true");
  set.run("theme_mode", json(THEME));
  set.run("analytics_enabled", "false");
  set.run("onboarding_completed", json(onboarded));
  // Keys never leave the real install; local models cover the screenshots.
  for (const key of ["llm_api_key", "remote_speech_api_key", "local_api_key"])
    set.run(key, json(""));
  set.run("remote_speech_enabled", "false");
  set.run("llm_enabled", "false");
  set.run("auto_update_enabled", "false");
  set.run("auto_launch_enabled", "false");
  set.run("start_in_background", "false");
  set.run("local_api_start_on_launch", "false");
  // `glimpse dev license` stands in for the license, so the real one stays out.
  db.run(
    "DELETE FROM settings WHERE key LIKE 'license_%' OR key = 'trial_ended_screen_seen'",
  );
  // Home asks (survey, review, star) stay hidden.
  const dismissed = json({
    prompt_version: 1,
    outcome: "dismissed",
    resolved_at: nowIso,
    history: {},
  });
  for (const key of ["survey_state", "review_state", "star_state"])
    set.run(key, dismissed);
  db.close();
};

const seedTranscriptions = (path) => {
  const db = new Database(path);
  db.run("DELETE FROM transcriptions");
  db.run("DELETE FROM library_items");
  db.run(
    "INSERT INTO lifetime_stats (id, words, duration_ms, dictations) VALUES (1, 48210, 21600000, 812) ON CONFLICT(id) DO UPDATE SET words = excluded.words, duration_ms = excluded.duration_ms, dictations = excluded.dictations",
  );

  const insertTranscription = db.prepare(
    `INSERT INTO transcriptions (id, timestamp, text, raw_text, audio_path, status, error_message, llm_cleaned, speech_model, llm_model, word_count, audio_duration_seconds, synced)
     VALUES (?1, ?2, ?3, NULL, '', 'success', NULL, 0, 'parakeet_unified_en_int8', NULL, ?4, ?5, 0)`,
  );
  TRANSCRIPTIONS.forEach((text, index) => {
    const words = text.split(/\s+/).length;
    // Newest first, spaced a few minutes apart, all earlier today.
    const timestamp = nowMs - (index + 1) * 4 * 60_000 - 90_000;
    insertTranscription.run(
      `demo-${index + 1}`,
      timestamp,
      text,
      words,
      Math.round((words / 152) * 60 * 10) / 10,
    );
  });

  const insertItem = db.prepare(
    `INSERT INTO library_items (id, name, audio_path, source_path, store_original, status, progress, error_message, transcript, segments, duration_seconds, file_size_bytes, original_format, created_at, transcribed_at, tags, llm_cleanup_enabled, speech_model, show_timestamps, kind)
     VALUES (?1, ?2, ?3, '', 0, ?4, ?5, NULL, ?6, NULL, ?7, ?8, ?9, ?10, ?11, '[]', 0, 'parakeet_unified_en_int8', 0, 'import')`,
  );
  LIBRARY_ITEMS.forEach((item, index) => {
    const id = `demo-library-${index + 1}`;
    const dir = join(
      sandboxData,
      "library",
      `${item.name.toLowerCase().replace(/\s+/g, "-")}-${id}`,
    );
    mkdirSync(dir, { recursive: true });
    const audioPath = join(dir, `${id}.wav`);
    writeFileSync(audioPath, silentWav(2));
    const createdAt = new Date(nowMs - (index + 1) * 40 * 60_000).toISOString();
    const transcribedAt =
      item.status === "complete"
        ? new Date(nowMs - index * 30 * 60_000).toISOString()
        : null;
    insertItem.run(
      id,
      item.name,
      audioPath,
      item.status,
      item.progress,
      item.transcript,
      item.duration,
      item.size,
      item.format,
      createdAt,
      transcribedAt,
    );
  });
  db.close();
};

const sandboxModels = join(sandboxData, "models");

// Each installed model is linked on its own, so anything new lands in the
// sandbox. The sandbox build refuses to download or delete models anyway.
const linkModels = () => {
  const realModels = join(realData, "models");
  if (!existsSync(realModels)) return;
  mkdirSync(sandboxModels, { recursive: true });
  for (const entry of readdirSync(realModels, { withFileTypes: true })) {
    const from = join(realModels, entry.name);
    const to = join(sandboxModels, entry.name);
    if (entry.isDirectory())
      symlinkSync(from, to, IS_WINDOWS ? "junction" : "dir");
    else copyFileSync(from, to);
  }
};

// Drops the model links first, so nothing below can follow one into the
// real models.
const unlinkModels = async () => {
  if (!existsSync(sandboxModels)) return;
  for (const entry of readdirSync(sandboxModels)) {
    const path = join(sandboxModels, entry);
    if (!lstatSync(path).isSymbolicLink()) continue;
    if (IS_WINDOWS) await run(["cmd", "/c", "rmdir", path]);
    else rmSync(path);
    if (existsSync(path))
      throw new Error(
        `Could not remove the model link ${path}; left the sandbox in place`,
      );
  }
};

const removeSandbox = async () => {
  await unlinkModels();
  if (!IS_WINDOWS && existsSync(bundle))
    await run([
      "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister",
      "-u",
      bundle,
    ]);
  rmSync(sandboxRoot, { recursive: true, force: true });
  if (IS_WINDOWS) {
    // WebView2 can hold its folder for a moment after the app exits.
    for (const path of [sandboxData, sandboxLocal])
      rmSync(path, { recursive: true, force: true, maxRetries: 10 });
  } else {
    for (const path of realHomeLeftovers)
      rmSync(path, { recursive: true, force: true });
    // Sockets and WebKit's temp files, named after the identifier.
    for (const path of [
      join(tmpdir(), "glimpse-comglimpsescreenshots.sock"),
      join(tmpdir(), DEMO_IDENTIFIER),
      "/tmp/com_glimpse_screenshots_si.sock",
    ])
      rmSync(path, { recursive: true, force: true });
  }
};

const writeBundle = () => {
  mkdirSync(dirname(appBinary), { recursive: true });
  mkdirSync(join(bundle, "Contents/Resources"), { recursive: true });
  copyFileSync(
    join(ROOT, "src-tauri/icons/icon.icns"),
    join(bundle, "Contents/Resources/icon.icns"),
  );
  // The app's own usage descriptions, under the sandbox's identity. No URL
  // schemes, so the sandbox never claims glimpse:// links.
  const plist = readFileSync(
    join(ROOT, "src-tauri/Info.plist"),
    "utf8",
  ).replace(
    "<dict>",
    `<dict>
    <key>CFBundleIdentifier</key><string>${DEMO_IDENTIFIER}</string>
    <key>CFBundleName</key><string>Glimpse Sandbox</string>
    <key>CFBundleExecutable</key><string>Glimpse</string>
    <key>CFBundlePackageType</key><string>APPL</string>
    <key>CFBundleIconFile</key><string>icon</string>
    <key>LSUIElement</key><true/>
    <key>NSHighResolutionCapable</key><true/>`,
  );
  writeFileSync(join(bundle, "Contents/Info.plist"), plist);
};

const prepareSandbox = async ({ onboarded }) => {
  await removeSandbox();
  mkdirSync(join(sandboxData, "Glimpse"), { recursive: true });

  sqliteBackup(
    join(realData, "Glimpse/settings.db"),
    join(sandboxData, "Glimpse/settings.db"),
  );
  sqliteBackup(
    join(realData, "transcriptions.db"),
    join(sandboxData, "transcriptions.db"),
  );
  seedSettings(join(sandboxData, "Glimpse/settings.db"), { onboarded });
  seedTranscriptions(join(sandboxData, "transcriptions.db"));
  linkModels();

  // Cached app and site icons, so personalization cards show them right away.
  const iconCache = join(realData, "local/cache");
  if (existsSync(iconCache))
    cpSync(iconCache, join(sandboxData, "local/cache"), { recursive: true });

  if (!IS_WINDOWS) writeBundle();
  // A hard link costs no space.
  try {
    linkSync(SANDBOX_BUILD, appBinary);
  } catch {
    copyFileSync(SANDBOX_BUILD, appBinary);
  }
  if (IS_WINDOWS) return;
  symlinkSync(appBinary, cli);
  const handy = join(
    sandboxHome,
    "Library/Application Support/com.pais.handy/settings_store.json",
  );
  mkdirSync(dirname(handy), { recursive: true });
  writeFileSync(handy, JSON.stringify(HANDY_SETTINGS));
};

// --- processes -------------------------------------------------------------

const waitFor = async (probe, timeoutMs, label) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await probe()) return;
    await sleep(150);
  }
  throw new Error(`Timed out waiting for ${label}`);
};

const viteUp = async () => {
  try {
    await fetch(`http://localhost:${VITE_PORT}/`);
    return true;
  } catch {
    return false;
  }
};

const appUp = async () => {
  const result = await runCli(["status", "--json"]);
  return result.code === 0 && result.stdout.includes('"app_running":true');
};

const dev = async (...devArgs) => {
  const result = await runCli(["dev", ...devArgs, "--json"]);
  if (result.code !== 0)
    throw new Error(
      `glimpse dev ${devArgs.join(" ")} failed: ${result.stderr || result.stdout}`,
    );
  return JSON.parse(result.stdout);
};

const open = async (target, tab) => {
  const result = await runCli(
    tab ? ["open", target, "--tab", tab] : ["open", target],
  );
  if (result.code !== 0)
    throw new Error(`open ${target} failed: ${result.stderr}`);
};

// The bundle identifier of the frontmost app, read without touching it.
const frontmostApp = async () => {
  const front = await run(["lsappinfo", "front"]);
  const info = await run([
    "lsappinfo",
    "info",
    "-only",
    "bundleid",
    front.stdout,
  ]);
  return info.stdout.match(/"([^"]+)"/)?.[1] ?? front.stdout;
};

// Samples the frontmost app for the whole run, to prove focus never moved to
// the sandbox.
const watchFocus = () => {
  const changes = [];
  let running = !IS_WINDOWS;
  const loop = (async () => {
    while (running) {
      const app = await frontmostApp();
      if (changes.at(-1)?.app !== app) changes.push({ app, at: elapsed() });
      await sleep(250);
    }
  })();
  return async () => {
    running = false;
    await loop;
    return changes;
  };
};

let shotCount = 0;
const shot = async (name, window = "settings") => {
  const idle = await dev("wait-idle", "--window", window);
  if (!idle.settled) log(`${name}: still busy after 10 s (${idle.reason})`);
  const info = await dev("window", window, "info");
  const { id } = info;
  shotCount += 1;
  const file =
    SCENARIO === "readme"
      ? `${name}.png`
      : `${String(shotCount).padStart(3, "0")}-${name}.png`;
  const out = join(OUT_DIR, file);
  if (IS_WINDOWS) {
    const result = await run([
      "powershell",
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      join(ROOT, "scripts/screenshots/window.ps1"),
      "-Hwnd",
      String(id),
      "-Out",
      out,
    ]);
    if (result.code !== 0)
      throw new Error(`window.ps1 failed: ${result.stderr}`);
  } else {
    const result = await run(["screencapture", "-x", "-l", String(id), out]);
    if (result.code !== 0)
      throw new Error(
        `screencapture failed: ${result.stderr} ${JSON.stringify(info)}`,
      );
  }
  log(`captured ${file}`);
};

// --- scenarios -------------------------------------------------------------

const MAIN_VIEWS = [
  "home",
  "dictionary",
  "personalization",
  "library",
  "record",
];
const SETTINGS_TABS = ["account", "general", "app", "about", "models", "api"];
const LICENSES = [
  "trial",
  "trial-last-day",
  "none",
  "expired",
  "unlocked-1",
  "unlocked-3",
];
const LOCKED_VIEWS = ["personalization", "library", "record"];
const TOASTS = ["milestone", "update", "no-words", "disk-full", "ask"];

const onboardingShots = async () => {
  await dev("onboarding", "reset");
  await dev("license", "trial");
  const step = async (name) => {
    await dev("onboarding", name);
    await shot(`setup-${name}`);
  };
  await step("welcome");
  try {
    await dev("onboarding", "import");
    await shot("setup-import");
  } catch (error) {
    if (!String(error.message).includes("has no")) throw error;
    log("no import step: no other dictation app was found");
  }
  await step("source");
  await dev("onboarding", "faq");
  await shot("setup-source-faq");
  await dev("onboarding", "close");
  try {
    await step("permissions");
  } catch (error) {
    if (!String(error.message).includes("has no")) throw error;
    log("no permissions step on this platform");
  }
  for (const license of ["trial", "none", "unlocked-1"]) {
    await dev("license", license);
    await dev("onboarding", "license");
    await shot(`setup-license-${license}`);
  }
  await dev("license", "trial");
  await step("done");
  await dev("onboarding", "setup-failed");
  await shot("setup-done-failed");
  await step("practice");
  await dev("onboarding", "download-failed");
  await shot("setup-practice-download-failed");
  await dev("onboarding", "source");
  await shot("setup-source-download-failed");
  await dev("onboarding", "disk-full");
  await shot("setup-source-disk-full");
  await dev("onboarding", "complete");
};

const mainShots = async () => {
  for (const view of MAIN_VIEWS) {
    await open(view);
    await shot(view);
  }
};

const settingsShots = async () => {
  for (const tab of SETTINGS_TABS) {
    await open("settings", tab);
    await shot(`settings-${tab}`);
  }
};

const paywallShots = async () => {
  for (const license of LICENSES) {
    await dev("license", license);
    await open("home");
    await shot(`${license}-home`);
    await open("settings", "account");
    await shot(`${license}-account`);
    if (license !== "none" && license !== "expired") continue;
    for (const view of LOCKED_VIEWS) {
      await open(view);
      await shot(`${license}-${view}-locked`);
    }
    await open("settings", "api");
    await shot(`${license}-settings-api-locked`);
  }
  await open("home");
  await dev("show", "trial-ended");
  await shot("trial-ended");
  await dev("show", "nothing");
};

// The newest CHANGELOG section, as the release notes dialog would show it.
const releaseNotes = () => {
  const lines = readFileSync(join(ROOT, "CHANGELOG.md"), "utf8").split("\n");
  const end = lines.findIndex(
    (line, index) => index > 0 && /^\d+\.\d+\.\d+\s*$/.test(line),
  );
  return lines
    .slice(1, end === -1 ? undefined : end)
    .join("\n")
    .trim();
};

const extraShots = async () => {
  await dev("license", "trial");
  await open("home");
  await dev("show", "release-notes", "--markdown", releaseNotes());
  await shot("release-notes");
  await dev("show", "nothing");
  for (const toast of TOASTS) {
    await dev("show", "toast", toast);
    await shot(`toast-${toast}`, "toast");
  }
  await dev("show", "nothing");
};

const SCENARIOS = {
  // The only scenario that takes focus: README images want active window
  // chrome. The sandbox activates itself, then hides so focus goes back.
  readme: {
    license: "unlocked-3",
    takesFocus: true,
    run: async () => {
      const frontBefore = IS_WINDOWS ? null : await frontmostApp();
      try {
        for (const view of [
          "home",
          "dictionary",
          "personalization",
          "library",
        ]) {
          // Something else can take focus mid-capture; the shot is then retaken.
          for (let attempt = 1; ; attempt += 1) {
            if (IS_WINDOWS || (await frontmostApp()) !== DEMO_IDENTIFIER)
              await dev("focus", "on");
            await open(view);
            await shot(view);
            if (IS_WINDOWS || (await frontmostApp()) === DEMO_IDENTIFIER) break;
            if (attempt === 3)
              throw new Error(`${view}: focus kept moving away; try again`);
            log(`${view}: focus moved away during the capture, retaking`);
          }
        }
      } finally {
        // Reported, not thrown, so it can't hide the error that got here.
        try {
          await dev("focus", "off");
          if (!IS_WINDOWS) {
            await waitFor(
              async () => (await frontmostApp()) !== DEMO_IDENTIFIER,
              5_000,
              "focus to go back",
            );
            const now = await frontmostApp();
            log(
              now === frontBefore
                ? `focus went back to ${now}`
                : `focus went to ${now}, not ${frontBefore} as before`,
            );
          }
        } catch (error) {
          console.error(`Giving focus back failed: ${error.message}`);
          process.exitCode = 1;
        }
      }
    },
  },
  onboarding: { license: "trial", onboarded: false, run: onboardingShots },
  settings: { license: "trial", run: settingsShots },
  paywall: { license: "trial", run: paywallShots },
  walkthrough: {
    license: "trial",
    onboarded: false,
    run: async () => {
      await onboardingShots();
      await mainShots();
      await settingsShots();
      await paywallShots();
      await extraShots();
    },
  },
};

// --- main ------------------------------------------------------------------

const scenario = SCENARIOS[SCENARIO];
if (!scenario) {
  console.error(
    `Unknown scenario ${SCENARIO}. Use one of: ${Object.keys(SCENARIOS).join(", ")}.`,
  );
  process.exit(1);
}

let vite = null;
let app = null;
if (scenario.takesFocus && !IS_WINDOWS)
  log(
    "the readme scenario brings the sandbox app to the front for a few seconds while it captures (keystrokes go to it meanwhile); every other scenario stays in the background",
  );
const stopWatching = watchFocus();
// One run at a time; a second one would remove the first one's sandbox.
const lock = join(tmpdir(), "glimpse-screenshots.lock");
try {
  mkdirSync(lock);
} catch {
  console.error(`Another screenshot run is going. If none is, remove ${lock}.`);
  process.exit(1);
}

// taskkill /T also ends the WebView2 and vite children.
const stop = async (proc) => {
  if (!proc) return;
  if (IS_WINDOWS) await run(["taskkill", "/T", "/F", "/PID", String(proc.pid)]);
  else proc.kill();
  await proc.exited.catch(() => {});
};

let cleanedUp = null;
const cleanup = () =>
  (cleanedUp ??= (async () => {
    await stop(app);
    await stop(vite);
    if (!KEEP) {
      await removeSandbox();
      rmSync(dirname(SANDBOX_BUILD), { recursive: true, force: true });
    }
    rmSync(lock, { recursive: true, force: true });
  })());

for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    console.error(`\n${signal}: cleaning up`);
    cleanup().finally(() => process.exit(130));
  });

try {
  if (await viteUp())
    throw new Error(
      `Port ${VITE_PORT} is taken; is another screenshot run going?`,
    );
  if (!SKIP_BUILD) {
    log("building the sandbox debug binary");
    const build = await run(
      ["cargo", "build", "--manifest-path", join(ROOT, "src-tauri/Cargo.toml")],
      {
        stderr: "inherit",
        env: {
          ...process.env,
          TAURI_CONFIG: JSON.stringify({
            identifier: DEMO_IDENTIFIER,
            build: { devUrl: `http://localhost:${VITE_PORT}` },
          }),
        },
      },
    );
    if (build.code !== 0) throw new Error("cargo build failed");
    mkdirSync(dirname(SANDBOX_BUILD), { recursive: true });
    renameSync(BUILT_BINARY, SANDBOX_BUILD);
  }
  if (!existsSync(SANDBOX_BUILD))
    throw new Error(
      `Missing ${SANDBOX_BUILD}; run without --skip-build, with --keep, first`,
    );

  log("preparing demo data");
  await prepareSandbox({ onboarded: scenario.onboarded ?? true });
  // A binary built for the real identifier would reach the installed app.
  const identifier = (await runCli(["dev", "identifier"])).stdout;
  if (identifier !== DEMO_IDENTIFIER)
    throw new Error(
      `${SANDBOX_BUILD} is not a sandbox build (${identifier || "no dev commands"}); run without --skip-build`,
    );
  mkdirSync(OUT_DIR, { recursive: true });

  log("starting the frontend dev server");
  vite = Bun.spawn(
    [
      "bun",
      "./node_modules/vite/bin/vite.js",
      "--port",
      String(VITE_PORT),
      "--strictPort",
    ],
    {
      cwd: ROOT,
      env: { ...process.env, VITE_GLIMPSE_SANDBOX: "1" },
      stdout: "ignore",
      stderr: "ignore",
    },
  );
  await waitFor(viteUp, 60_000, "vite");

  log(`launching the sandbox app (${SCENARIO})`);
  app = Bun.spawn([appBinary], {
    env: {
      ...sandboxEnv,
      GLIMPSE_DEV_LICENSE: scenario.license,
      GLIMPSE_DEMO_ACCOUNT_NAME: ACCOUNT_NAME,
    },
    stdout: "ignore",
    stderr: "ignore",
  });
  await waitFor(appUp, 90_000, "Glimpse to start");

  // The window opens at launch; it only needs its size.
  await dev("wait-idle");
  await dev(
    "window",
    "settings",
    "size",
    String(WINDOW.width),
    String(WINDOW.height),
  );
  if (IS_WINDOWS)
    await dev(
      "window",
      "settings",
      "position",
      String(WINDOW.x),
      String(WINDOW.y),
    );
  await scenario.run();
  log(`${shotCount} screenshots in ${OUT_DIR}`);
} catch (error) {
  console.error(error.message ?? error);
  process.exitCode = 1;
} finally {
  await cleanup();
  const changes = await stopWatching();
  if (!IS_WINDOWS) {
    log(
      `frontmost app: ${changes.map(({ app, at }) => `${app} (${at})`).join(" → ")}`,
    );
    if (
      !scenario.takesFocus &&
      changes.some(({ app }) => app === DEMO_IDENTIFIER)
    ) {
      console.error("The sandbox app came to the front.");
      process.exitCode = 1;
    }
  }
  log(`took ${Math.round((Date.now() - started) / 1000)} s`);
}
