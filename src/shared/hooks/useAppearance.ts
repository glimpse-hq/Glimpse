import { useCallback, useEffect, useRef } from "react";
import { detectAppPlatform } from "../../platform/service";
import {
  parseTextSizeMode,
  resolveTextScale,
  TEXT_SIZE_MODE_STORAGE_KEY,
} from "../lib/textSize";
import { parseThemeMode, resolveThemeAttribute } from "../lib/theme";
import type { TextSizeMode, ThemeMode } from "../../types";
import { useTauriEvent } from "./useTauriEvent";

const applyTextScale = (mode: TextSizeMode) => {
  document.documentElement.style.setProperty(
    "--ui-text-scale",
    resolveTextScale(mode, detectAppPlatform()),
  );
};

// Follows the app's text size setting, including live changes.
export function useTextScale() {
  useEffect(() => {
    const root = document.documentElement;
    applyTextScale(
      parseTextSizeMode(localStorage.getItem(TEXT_SIZE_MODE_STORAGE_KEY)),
    );
    root.classList.add("text-scale-anim-ready");
    return () => root.classList.remove("text-scale-anim-ready");
  }, []);

  useTauriEvent<{ mode?: TextSizeMode }>("ui:text_size_changed", (payload) => {
    applyTextScale(parseTextSizeMode(payload?.mode ?? null));
  });
}

// Follows the app's theme setting, the system appearance and live changes.
export function useTheme(themeMode: string | null, isLoading: boolean) {
  const currentModeRef = useRef<ThemeMode>("system");

  const applyTheme = useCallback((mode: ThemeMode) => {
    currentModeRef.current = mode;
    document.documentElement.dataset.theme = resolveThemeAttribute(mode);
  }, []);

  useEffect(() => {
    // main.tsx already applied the saved mode for the first paint.
    if (isLoading) return;

    applyTheme(parseThemeMode(themeMode));

    const mediaQuery = window.matchMedia("(prefers-color-scheme: light)");
    const handleSystemChange = () => {
      if (currentModeRef.current === "system") applyTheme("system");
    };
    mediaQuery.addEventListener("change", handleSystemChange);
    return () => mediaQuery.removeEventListener("change", handleSystemChange);
  }, [applyTheme, isLoading, themeMode]);

  useTauriEvent<{ mode?: ThemeMode }>(
    "ui:theme_changed",
    (payload) => applyTheme(parseThemeMode(payload?.mode ?? null)),
    { enabled: !isLoading },
  );
}
