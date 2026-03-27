import { useState, useEffect, ComponentType } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import PillOverlay from "../features/pill/PillOverlay";
import ToastOverlay from "../features/toast/ToastOverlay";
import Home from "../Home";
import OnboardingScreen from "../features/onboarding/OnboardingScreen";
import { useSettings } from "../features/settings/queries";
import type { TextSizeMode } from "../types";
import "./App.css";

const TEXT_SIZE_MODE_STORAGE_KEY = "glimpse_text_size_mode";

const parseTextSizeMode = (value: string | null): TextSizeMode =>
  value === "small" || value === "default" || value === "large" ? value : "default";

const resolveTextScale = (mode: TextSizeMode): string => {
  switch (mode) {
    case "small":
      return "0.94";
    case "large":
      return "1.08";
    default:
      return "1";
  }
};

function App() {
  const [windowLabel] = useState(() => getCurrentWindow().label);

  const isSettingsWindow = windowLabel === "settings";

  const { data: settings, isLoading: settingsLoading } = useSettings(
    undefined,
    isSettingsWindow,
  );

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

    const applyTextScale = (mode: TextSizeMode) => {
      const scaleValue = resolveTextScale(mode);
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
    const body = document.body;
    const html = document.documentElement;
    if (windowLabel === "settings") {
      html.style.backgroundColor = "var(--color-bg-primary)";
      body.style.backgroundColor = "var(--color-bg-primary)";
    } else {
      html.style.backgroundColor = "";
      body.style.backgroundColor = "";
    }
    return () => {
      html.style.backgroundColor = "";
      body.style.backgroundColor = "";
    };
  }, [windowLabel]);

  const showOnboarding =
    isSettingsWindow && !!settings && !settings.onboarding_completed;

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
