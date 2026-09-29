import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { detectAppPlatform } from "../../platform/service";
import {
  parseTextSizeMode,
  resolveTextScale,
  TEXT_SIZE_MODE_STORAGE_KEY,
} from "../lib/textSize";
import { parseThemeMode, resolveThemeAttribute } from "../lib/theme";
import type { TextSizeMode, ThemeMode } from "../../types";

// Follows the app's text size setting, including live changes.
export function useTextScale() {
  useEffect(() => {
    const root = document.documentElement;
    const applyTextScale = (mode: TextSizeMode) => {
      root.style.setProperty(
        "--ui-text-scale",
        resolveTextScale(mode, detectAppPlatform()),
      );
    };

    applyTextScale(
      parseTextSizeMode(localStorage.getItem(TEXT_SIZE_MODE_STORAGE_KEY)),
    );
    root.classList.add("text-scale-anim-ready");

    const unlistenPromise = listen<{ mode?: TextSizeMode }>(
      "ui:text_size_changed",
      (event) => {
        applyTextScale(parseTextSizeMode(event.payload?.mode ?? null));
      },
    );

    return () => {
      root.classList.remove("text-scale-anim-ready");
      unlistenPromise.then((unlisten) => unlisten()).catch(() => {});
    };
  }, []);
}

// Follows the app's theme setting, the system appearance and live changes.
export function useTheme(themeMode: string | null, isLoading: boolean) {
  useEffect(() => {
    // main.tsx already applied the saved mode for the first paint.
    if (isLoading) return;

    const root = document.documentElement;
    let currentMode = parseThemeMode(themeMode);

    const applyTheme = (mode: ThemeMode) => {
      currentMode = mode;
      root.dataset.theme = resolveThemeAttribute(mode);
    };

    applyTheme(currentMode);

    const mediaQuery = window.matchMedia("(prefers-color-scheme: light)");
    const handleSystemChange = () => {
      if (currentMode === "system") applyTheme("system");
    };
    mediaQuery.addEventListener("change", handleSystemChange);

    const unlistenPromise = listen<{ mode?: ThemeMode }>(
      "ui:theme_changed",
      (event) => {
        applyTheme(parseThemeMode(event.payload?.mode ?? null));
      },
    );

    return () => {
      mediaQuery.removeEventListener("change", handleSystemChange);
      unlistenPromise.then((unlisten) => unlisten()).catch(() => {});
    };
  }, [isLoading, themeMode]);
}
