#!/usr/bin/env bun
// Symbolicates Glimpse frames from a macOS crash report or a PostHog `frames`
// list with the release dSYMs (the `glimpse-<version>-macos-dsym` artifact of
// the publish workflow run). macOS only: uses atos and c++filt from Xcode.
//
//   bun scripts/symbolicate.mjs --dsym <dir|Glimpse.dSYM> Glimpse-2026-09-26-014327.ips
//   bun scripts/symbolicate.mjs --dsym <dir> '["libsystem_c.dylib+0x7b458","Glimpse+0x2ed2748"]'
//   pbpaste | bun scripts/symbolicate.mjs --dsym <dir> --arch x86_64
//
// Frame lists are `module+0xoffset` entries (JSON array, or one per line or
// argument). Their arch defaults to arm64; pass the event's `diagnostics.arch`.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const usage = () => {
  console.error(
    "usage: bun scripts/symbolicate.mjs --dsym <dir|Glimpse.dSYM> [--arch arm64|x86_64] [report.ips | frames...]",
  );
  process.exit(2);
};

const args = process.argv.slice(2);
let dsymPath;
let arch;
const inputs = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--dsym") dsymPath = args[++i];
  else if (args[i] === "--arch") arch = args[++i];
  else if (args[i] === "-h" || args[i] === "--help") usage();
  else inputs.push(args[i]);
}
if (!dsymPath || !existsSync(dsymPath)) usage();

const run = (cmd) => {
  const result = Bun.spawnSync(cmd, { stderr: "pipe" });
  if (result.exitCode !== 0)
    throw new Error(`${cmd[0]} failed: ${result.stderr.toString().trim()}`);
  return result.stdout.toString();
};

// The artifact holds one dSYM per arch; map each slice UUID to its bundle.
const findDsyms = (path) =>
  path.endsWith(".dSYM")
    ? [path]
    : readdirSync(path).flatMap((name) => {
        const child = join(path, name);
        return statSync(child).isDirectory() ? findDsyms(child) : [];
      });
const slices = findDsyms(dsymPath).flatMap((bundle) =>
  [
    ...run(["dwarfdump", "--uuid", bundle]).matchAll(/UUID: (\S+) \((\S+)\)/g),
  ].map(([, uuid, sliceArch]) => ({
    bundle,
    uuid: uuid.toLowerCase(),
    arch: sliceArch,
  })),
);
if (slices.length === 0) throw new Error(`No dSYM found in ${dsymPath}`);

// Each frame: { module, offset, symbol? }. `uuid` is known only for .ips input.
let frames;
let uuid;
const input = inputs.length > 0 ? inputs.join("\n") : await Bun.stdin.text();
if (inputs.length === 1 && inputs[0].endsWith(".ips")) {
  const [header, ...body] = readFileSync(inputs[0], "utf8").split("\n");
  const report = JSON.parse(body.join("\n"));
  const images = report.usedImages ?? [];
  const glimpse = images.find((image) => image.name === "Glimpse");
  uuid = glimpse?.uuid?.toLowerCase();
  arch ??= glimpse?.arch;
  const thread = report.threads[report.faultingThread];
  console.log(
    `${JSON.parse(header).app_version ?? "?"} ${report.exception?.type ?? ""} ${report.exception?.signal ?? ""}`.trim(),
  );
  frames = thread.frames.map((frame) => ({
    module: images[frame.imageIndex]?.name ?? "???",
    offset: frame.imageOffset,
    symbol: frame.symbol,
  }));
} else {
  const trimmed = input.trim();
  const labels = trimmed.startsWith("[")
    ? JSON.parse(trimmed)
    : trimmed.split(/[\s,]+/).filter(Boolean);
  frames = labels.map((label) => {
    const [module, offset] = String(label).split("+");
    return { module, offset: Number.parseInt(offset, 16) };
  });
}

arch = { aarch64: "arm64", x86: "x86_64" }[arch] ?? arch ?? "arm64";
const slice = uuid
  ? slices.find((candidate) => candidate.uuid === uuid)
  : slices.find((candidate) => candidate.arch === arch);
if (!slice) {
  const have = slices.map((s) => `${s.uuid} (${s.arch})`).join(", ");
  throw new Error(
    `No dSYM matches ${uuid ? `binary UUID ${uuid}` : arch}; have ${have}`,
  );
}

// One atos call for every Glimpse frame. With -i, inlined frames come first
// and the delimiter separates addresses. Frames below the top are return
// addresses, so they are looked up one byte earlier, inside the call.
const DELIMITER = "@@frame@@";
const ours = frames.filter((frame) => frame.module === "Glimpse");
const lookup = (frame) => frame.offset - (frames.indexOf(frame) > 0 ? 1 : 0);
const resolved = new Map();
if (ours.length > 0) {
  const output = run([
    "atos",
    "-i",
    "--fullPath",
    "-d",
    DELIMITER,
    "-arch",
    slice.arch,
    "-o",
    slice.bundle,
    "--offset",
    ...ours.map((frame) => `0x${lookup(frame).toString(16)}`),
  ]);
  const demangled = Bun.spawnSync(["c++filt"], {
    stdin: new TextEncoder().encode(output),
  }).stdout.toString();
  demangled.split(DELIMITER).forEach((group, index) => {
    const lines = group
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    if (index < ours.length) resolved.set(ours[index], lines);
  });
}

// c++filt leaves the `$LT$`-style escapes and hash of legacy Rust mangling.
const LEGACY_ESCAPES = {
  SP: "@",
  BP: "*",
  RF: "&",
  LT: "<",
  GT: ">",
  LP: "(",
  RP: ")",
  C: ",",
};
const demangleLegacy = (line) =>
  line
    .replace(/\$(SP|BP|RF|LT|GT|LP|RP|C)\$/g, (_, code) => LEGACY_ESCAPES[code])
    .replace(/\$u([0-9a-f]+)\$/g, (_, hex) =>
      String.fromCharCode(Number.parseInt(hex, 16)),
    )
    .replace(/::h[0-9a-f]{16}\b/g, "")
    .replace(/\.\./g, "::")
    .replace(/(^|::)_(?=[{<])/g, "$1");

// `/rustc/<hash>/library/…` and absolute CI or registry paths are trimmed.
const shortPath = (line) =>
  demangleLegacy(line)
    .replace(/ \(in [^)]+\)/, "")
    .replace(/\/rustc\/[0-9a-f]+\//, "rust/")
    .replace(/\([^()]*\/rustlib\/src\/rust\//, "(rust/")
    .replace(/\([^()]*\/(src-tauri\/)/, "($1")
    .replace(/\([^()]*\/registry\/src\/[^/]+\//, "(")
    .replace(/\([^()]*\/git\/checkouts\/[^/]+\/[^/]+\//, "(");

frames.forEach((frame, index) => {
  const label = `${frame.module}+0x${frame.offset.toString(16)}`;
  const lines = resolved.get(frame);
  if (!lines || lines.length === 0) {
    console.log(
      `${String(index).padStart(2)}  ${label}  ${frame.symbol ?? ""}`,
    );
    return;
  }
  const [outer, ...inlined] = lines.reverse().map(shortPath);
  console.log(`${String(index).padStart(2)}  ${label}  ${outer}`);
  for (const line of inlined) console.log(`      inlined  ${line}`);
});
