import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "@lingui/cli";

const SUPPORTED_APP_LOCALES_PATH = resolve(
  process.cwd(),
  "supported-app-locales.json",
);

// Main source of truth for shipped app translations.
const SUPPORTED_APP_LOCALES = JSON.parse(
  readFileSync(SUPPORTED_APP_LOCALES_PATH, "utf8"),
);

if (!Array.isArray(SUPPORTED_APP_LOCALES) || SUPPORTED_APP_LOCALES.length === 0) {
  throw new Error("supported-app-locales.json must be a non-empty array");
}

if (
  SUPPORTED_APP_LOCALES.some(
    (locale) =>
      typeof locale !== "string" ||
      locale.length === 0 ||
      locale !== locale.trim() ||
      locale !== locale.toLowerCase(),
  )
) {
  throw new Error("supported-app-locales.json must use lowercase, trimmed locale codes");
}

const seenLocales = new Set<string>();
for (const locale of SUPPORTED_APP_LOCALES) {
  if (seenLocales.has(locale)) {
    throw new Error(`supported-app-locales.json contains duplicate locale: ${locale}`);
  }
  seenLocales.add(locale);
}

export default defineConfig({
  locales: SUPPORTED_APP_LOCALES,
  sourceLocale: "en",
  fallbackLocales: {
    default: "en",
  },
  format: "po",
  catalogs: [
    {
      path: "src/locales/{locale}/messages",
      include: ["src"],
      exclude: ["src/locales/**", "**/*.d.ts"],
    },
  ],
});
