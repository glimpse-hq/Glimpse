import { defineConfig } from "@lingui/cli";

export default defineConfig({
  locales: ["en", "fr"],
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
