import js from "@eslint/js";
import tseslint from "typescript-eslint";
import boundaries from "eslint-plugin-boundaries";

export default tseslint.config(
  {
    ignores: ["dist/**", "src-tauri/**", "node_modules/**", "*.config.*"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: {
      boundaries,
    },
    settings: {
      "boundaries/elements": [
        { type: "app", pattern: "src/app/**" },
        { type: "feature", pattern: "src/features/**" },
        { type: "shared", pattern: "src/shared/**" },
        { type: "legacy", pattern: "src/**", mode: "file" },
      ],
      "boundaries/ignore": ["**/*.test.*", "**/*.spec.*"],
    },
    rules: {
      // Feature isolation: features cannot import from other features
      "boundaries/dependencies": [
        "warn",
        {
          default: "disallow",
          rules: [
            { from: "app", allow: ["app", "feature", "shared", "legacy"] },
            { from: "feature", allow: ["shared", "legacy"] },
            { from: "shared", allow: ["shared", "legacy"] },
            { from: "legacy", allow: ["app", "feature", "shared", "legacy"] },
          ],
        },
      ],
      // No direct @tauri-apps imports outside allowed files
      "no-restricted-imports": [
        "warn",
        {
          patterns: [
            {
              group: ["@tauri-apps/api/*"],
              message:
                "Use @/shared/tauri helpers or feature api.ts instead of direct @tauri-apps imports.",
            },
          ],
        },
      ],
      // Disable rules that conflict with TypeScript or flag pre-existing code
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "off",
      "no-unused-vars": "off",
      "no-useless-assignment": "off",
    },
  },
  // Override: allow @tauri-apps imports in shared/tauri, feature api/query files, and legacy
  {
    files: [
      "src/shared/tauri/**/*.ts",
      "src/features/*/api.ts",
      "src/features/*/models-api.ts",
      "src/features/*/queries.ts",
      "src/features/*/models-queries.ts",
      "src/features/*/components/**/*.tsx",
      "src/features/*/steps/**/*.tsx",
      "src/features/*/*.ts",
      "src/features/*/*.tsx",
      "src/Home.tsx",
      "src/app/App.tsx",
      "src/hooks/**/*.ts",
      "src/lib/**/*.ts",
    ],
    rules: {
      "no-restricted-imports": "off",
    },
  },
  // Override: allow cross-feature imports for settings (cross-cutting)
  {
    files: ["src/features/*/queries.ts", "src/features/*/components/**/*.tsx"],
    rules: {
      "boundaries/dependencies": [
        "warn",
        {
          default: "disallow",
          rules: [
            { from: "feature", allow: ["feature", "shared", "legacy"] },
          ],
        },
      ],
    },
  },
);
