import type { ThemeMode } from "../../types";

export const parseThemeMode = (value: string | null): ThemeMode =>
  value === "light" || value === "dark" || value === "system"
    ? value
    : "system";

export const resolveThemeAttribute = (mode: ThemeMode): "light" | "dark" => {
  if (mode === "system") {
    return window.matchMedia("(prefers-color-scheme: light)").matches
      ? "light"
      : "dark";
  }
  return mode;
};
