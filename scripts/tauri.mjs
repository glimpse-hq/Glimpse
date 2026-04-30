import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const env = { ...process.env };
const args = process.argv.slice(2);

if (process.platform === "win32" && !env.CARGO_TARGET_DIR) {
  env.CARGO_TARGET_DIR =
    env.GLIMPSE_CARGO_TARGET_DIR ?? env.RUNNER_TEMP ?? path.join(os.tmpdir(), "g");
}

const tauriCli = path.join(
  process.cwd(),
  "node_modules",
  "@tauri-apps",
  "cli",
  "tauri.js",
);

const child = spawn(process.execPath, [tauriCli, ...args], {
  env,
  stdio: "inherit",
});

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
