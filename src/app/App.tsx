import { useState, useEffect, ComponentType } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import PillOverlay from "../features/pill/PillOverlay";
import ToastOverlay from "../features/toast/ToastOverlay";
import Home from "../Home";
import OnboardingScreen from "../features/onboarding/OnboardingScreen";
import { useSettings } from "../features/settings/queries";
import type { TextSizeMode, ThemeMode } from "../types";
import { detectAppPlatform } from "../platform/service";
import { parseTextSizeMode, resolveTextScale } from "../shared/lib/textSize";
import "./App.css";

const TEXT_SIZE_MODE_STORAGE_KEY = "glimpse_text_size_mode";
const THEME_MODE_STORAGE_KEY = "glimpse_theme_mode";

const parseThemeMode = (value: string | null): ThemeMode =>
  value === "light" || value === "dark" || value === "system" ? value : "system";

const resolveThemeAttribute = (mode: ThemeMode): "light" | "dark" => {
  if (mode === "system") {
    return window.matchMedia("(prefers-color-scheme: light)").matches
      ? "light"
      : "dark";
  }
  return mode;
};

function App() {
  const [windowLabel] = useState(() => getCurrentWindow().label);

  const isSettingsWindow = windowLabel === "settings";

  const { data: settings, isLoading: settingsLoading } = useSettings(
    undefined,
    isSettingsWindow,
  );
  const showOnboarding =
    isSettingsWindow && !!settings && !settings.onboarding_completed;

  useEffect(() => {
    const handleContextMenu = (event: MouseEvent) => {
      event.preventDefault();
    };
    document.addEventListener("contextmenu", handleContextMenu);
    return () => document.removeEventListener("contextmenu", handleContextMenu);
  }, []);

  useEffect(() => {
    const root = document.documentElement;

    if (windowLabel !== "settings") {
      root.classList.remove("text-scale-anim-ready");
      root.style.setProperty("--ui-text-scale", "1");
      return;
    }

    const platform = detectAppPlatform();
    const applyTextScale = (mode: TextSizeMode) => {
      const scaleValue = resolveTextScale(mode, platform);
      root.style.setProperty("--ui-text-scale", scaleValue);
    };

    applyTextScale(parseTextSizeMode(localStorage.getItem(TEXT_SIZE_MODE_STORAGE_KEY)));
    root.classList.add("text-scale-anim-ready");

    const unlistenPromise = listen<{ mode?: TextSizeMode }>("ui:text_size_changed", (event) => {
      applyTextScale(parseTextSizeMode(event.payload?.mode ?? null));
    });

    return () => {
      root.classList.remove("text-scale-anim-ready");
      unlistenPromise.then((unlisten) => unlisten()).catch(() => {});
    };
  }, [windowLabel]);

  useEffect(() => {
    const root = document.documentElement;

    // Pill & toast overlays always render in dark: they're transparent
    // floating chrome that lives on top of the user's workspace, not app UI.
    // The settings window also boots dark until onboarding state is known, and
    // onboarding itself stays dark regardless of the user's saved theme.
    if (windowLabel !== "settings" || settingsLoading || showOnboarding) {
      root.dataset.theme = "dark";
      return;
    }

    let currentMode: ThemeMode = parseThemeMode(
      localStorage.getItem(THEME_MODE_STORAGE_KEY),
    );

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
  }, [settingsLoading, showOnboarding, windowLabel]);

  useEffect(() => {
    const body = document.body;
    const html = document.documentElement;
    if (windowLabel === "settings") {
      html.style.backgroundColor = "var(--color-bg-secondary)";
      body.style.backgroundColor = "var(--color-bg-secondary)";
    } else {
      html.style.backgroundColor = "";
      body.style.backgroundColor = "";
    }
    return () => {
      html.style.backgroundColor = "";
      body.style.backgroundColor = "";
    };
  }, [windowLabel]);

  if (windowLabel === "settings") {
    if (settingsLoading) {
      return (
        <div className="settings-view h-screen w-screen overflow-hidden bg-surface-secondary" />
      );
    }

    return (
      <div className="settings-view h-screen w-screen overflow-hidden">
        {showOnboarding ? (
          <OnboardingScreen onComplete={() => {}} />
        ) : (
          <Home />
        )}
      </div>
    );
  }

  const overlayRegistry: Record<string, ComponentType<Record<string, never>>> = {
    main: PillOverlay,
    pill: PillOverlay,
    toast: ToastOverlay,
  };

  const ActiveOverlay = overlayRegistry[windowLabel] ?? PillOverlay;
  return (
    <div className="flex h-screen w-screen items-center justify-center overflow-hidden">
      <ActiveOverlay />
    </div>
  );
}

export default App;
