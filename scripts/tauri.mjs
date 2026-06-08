// Windows wrapper for `tauri dev` / `tauri build`:
// - short CARGO_TARGET_DIR + TEMP to avoid MAX_PATH in whisper Vulkan builds
import { spawn } from "node:child_process";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const env = { ...process.env };
const args = process.argv.slice(2);

if (process.platform === "win32") {
  configureWindowsEnv();
}

function defaultWindowsCargoTargetDir() {
  return path.join(path.parse(process.cwd()).root, ".glimpse-cargo-target");
}

function configureWindowsEnv() {
  if (!env.CARGO_TARGET_DIR) {
    env.CARGO_TARGET_DIR =
      env.GLIMPSE_CARGO_TARGET_DIR ??
      (env.CI && env.RUNNER_TEMP
        ? path.join(env.RUNNER_TEMP, "cargo-target")
        : defaultWindowsCargoTargetDir());
  }

  fs.mkdirSync(env.CARGO_TARGET_DIR, { recursive: true });

  const shortTemp = path.join(env.CARGO_TARGET_DIR, "tmp");
  fs.mkdirSync(shortTemp, { recursive: true });
  env.TEMP = shortTemp;
  env.TMP = shortTemp;
}

function findVsDevCmd() {
  const explicit = env.VSDEVCMD_PATH;
  if (explicit && fs.existsSync(explicit)) {
    return explicit;
  }

  const vswhere = path.join(
    env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)",
    "Microsoft Visual Studio",
    "Installer",
    "vswhere.exe",
  );

  if (fs.existsSync(vswhere)) {
    try {
      const installationPath = execFileSync(
        vswhere,
        [
          "-latest",
          "-products",
          "*",
          "-requires",
          "Microsoft.VisualStudio.Component.VC.Tools.x86.x64",
          "-property",
          "installationPath",
        ],
        { env, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
      ).trim();
      const candidate = path.join(
        installationPath,
        "Common7",
        "Tools",
        "VsDevCmd.bat",
      );
      if (candidate && fs.existsSync(candidate)) {
        return candidate;
      }
    } catch {
      // Fall back to known install layouts below.
    }
  }

  const programFiles = env.ProgramFiles ?? "C:\\Program Files";
  const programFilesX86 = env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)";
  const years = ["18", "2022", "2019"];
  const editions = ["Community", "Professional", "Enterprise", "BuildTools"];

  for (const root of [programFiles, programFilesX86]) {
    for (const year of years) {
      for (const edition of editions) {
        const candidate = path.join(
          root,
          "Microsoft Visual Studio",
          year,
          edition,
          "Common7",
          "Tools",
          "VsDevCmd.bat",
        );
        if (fs.existsSync(candidate)) {
          return candidate;
        }
      }
    }
  }

  return undefined;
}

function quoteCmd(value) {
  return `"${value.replace(/"/g, '""')}"`;
}

function windowsCmdPath() {
  return "C:\\Windows\\System32\\cmd.exe";
}

const tauriCli = path.join(
  process.cwd(),
  "node_modules",
  "@tauri-apps",
  "cli",
  "tauri.js",
);

function spawnTauriCli() {
  const needsNativeBuild = args[0] === "dev" || args[0] === "build";

  if (process.platform === "win32") {
    const vsDevCmd = findVsDevCmd();

    if (!vsDevCmd && needsNativeBuild) {
      console.warn(
        "Glimpse: VsDevCmd.bat not found. Install Visual Studio 2022 (Desktop development with C++) or Build Tools, or set VSDEVCMD_PATH.",
      );
    }

    if (vsDevCmd && needsNativeBuild) {
      const tauriCommand = [
        quoteCmd(process.execPath),
        quoteCmd(tauriCli),
        ...args.map((arg) => quoteCmd(arg)),
      ].join(" ");
      const batPath = path.join(env.CARGO_TARGET_DIR, "glimpse-tauri.cmd");
      const batContents = [
        "@echo off",
        "setlocal EnableExtensions DisableDelayedExpansion",
        `call ${quoteCmd(vsDevCmd)} -no_logo`,
        `set "CARGO_TARGET_DIR=${env.CARGO_TARGET_DIR}"`,
        `set "TEMP=${env.TEMP}"`,
        `set "TMP=${env.TMP}"`,
        tauriCommand,
        "",
      ].join("\r\n");
      fs.writeFileSync(batPath, batContents);

      return spawn(windowsCmdPath(), ["/d", "/c", batPath], {
        env,
        stdio: "inherit",
        shell: false,
      });
    }
  }

  return spawn(process.execPath, [tauriCli, ...args], {
    env,
    stdio: "inherit",
  });
}

const child = spawnTauriCli();

child.on("error", (error) => {
  console.error(`Failed to spawn Tauri CLI at ${tauriCli}: ${error.message}`);
  process.exit(1);
});

function iconOutputDir() {
  const outputIndex = args.findIndex((arg) => arg === "--output" || arg === "-o");
  if (outputIndex >= 0 && args[outputIndex + 1]) {
    return path.resolve(process.cwd(), args[outputIndex + 1]);
  }

  const inlineOutput = args.find((arg) => arg.startsWith("--output="));
  if (inlineOutput) {
    return path.resolve(process.cwd(), inlineOutput.slice("--output=".length));
  }

  return path.join(process.cwd(), "src-tauri", "icons");
}

function removeMobileIconOutputs() {
  const outputDir = iconOutputDir();

  for (const directory of ["android", "ios"]) {
    fs.rmSync(path.join(outputDir, directory), { recursive: true, force: true });
  }
}

function generatedIcons() {
  return (
    args[0] === "icon" &&
    !args.includes("--help") &&
    !args.includes("-h") &&
    !args.includes("--version") &&
    !args.includes("-V")
  );
}

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  if (code === 0 && generatedIcons()) {
    removeMobileIconOutputs();
  }

  process.exit(code ?? 1);
});
