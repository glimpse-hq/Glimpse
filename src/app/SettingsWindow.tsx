import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  AnimatePresence,
  MotionConfig,
  motion,
  PresenceContext,
} from "framer-motion";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { activateLocale } from "../i18n";
import { licenseKeys } from "../features/license/queries";
import { detectAppPlatform } from "../platform/service";
import {
  parseTextSizeMode,
  resolveTextScale,
  TEXT_SIZE_MODE_STORAGE_KEY,
} from "../shared/lib/textSize";
import { modelKeys } from "../features/settings/models-queries";
import { settingsKeys, useSettings } from "../features/settings/queries";
import { transcriptionKeys } from "../features/transcriptions/queries";
import { updateKeys } from "../features/updates/queries";
import type { LicenseState } from "../shared/types/license";
import type { StoredSettings, TextSizeMode, ThemeMode } from "../types";

const Home = lazy(() => import("../Home"));
const AneCompileOverlay = lazy(
  () => import("../features/settings/components/AneCompileOverlay"),
);
const OnboardingScreen = lazy(
  () => import("../features/onboarding/OnboardingScreen"),
);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

const parseThemeMode = (value: string | null): ThemeMode =>
  value === "light" || value === "dark" || value === "system"
    ? value
    : "system";

const resolveThemeAttribute = (mode: ThemeMode): "light" | "dark" => {
  if (mode === "system") {
    return window.matchMedia("(prefers-color-scheme: light)").matches
      ? "light"
      : "dark";
  }
  return mode;
};

function QuerySyncBridge() {
  useEffect(() => {
    let cancelled = false;
    const unlisteners: UnlistenFn[] = [];

    const register = <TPayload,>(
      event: string,
      handler: (payload: TPayload) => void,
    ) => {
      listen<TPayload>(event, (eventPayload) => {
        if (!cancelled) handler(eventPayload.payload);
      })
        .then((unlisten) => {
          if (cancelled) unlisten();
          else unlisteners.push(unlisten);
        })
        .catch(() => {});
    };

    register<StoredSettings>("settings:changed", (settings) => {
      queryClient.setQueryData(settingsKeys.detail(), settings);
      queryClient.invalidateQueries({ queryKey: modelKeys.speech() });
    });
    register<LicenseState>("license:changed", (state) => {
      queryClient.setQueryData(licenseKeys.state(), state);
    });
    register("update:available", () => {
      queryClient.invalidateQueries({ queryKey: updateKeys.status() });
    });
    register("update:cleared", () => {
      queryClient.invalidateQueries({ queryKey: updateKeys.status() });
    });
    register("transcription:complete", () => {
      queryClient.invalidateQueries({ queryKey: transcriptionKeys.all });
    });
    register("transcription:error", () => {
      queryClient.invalidateQueries({ queryKey: transcriptionKeys.all });
    });
    register("audio:input-devices-changed", () => {
      queryClient.invalidateQueries({ queryKey: settingsKeys.devices() });
    });

    return () => {
      cancelled = true;
      unlisteners.forEach((unlisten) => unlisten());
    };
  }, []);

  return null;
}

function SettingsContent() {
  const { data: settings, isLoading } = useSettings();
  const showOnboarding = !!settings && !settings.onboarding_completed;
  // Home builds in only after onboarding, not on a normal launch.
  const [homeEnters, setHomeEnters] = useState(false);
  if (showOnboarding && !homeEnters) setHomeEnters(true);
  const didActivateInitialLocale = useRef(false);

  useEffect(() => {
    // Later locale changes activate immediately in the settings form.
    if (!settings || didActivateInitialLocale.current) return;
    didActivateInitialLocale.current = true;
    void activateLocale(settings.app_locale);
  }, [settings]);

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

  useEffect(() => {
    const root = document.documentElement;
    if (isLoading) {
      root.dataset.theme = "dark";
      return;
    }

    let currentMode = parseThemeMode(settings?.theme_mode ?? null);

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
  }, [isLoading, settings?.theme_mode]);

  if (isLoading) {
    return (
      <div className="settings-view h-screen w-screen overflow-hidden bg-surface-secondary" />
    );
  }

  return (
    <MotionConfig reducedMotion="user">
      <div className="settings-view h-screen w-screen overflow-hidden">
        <AnimatePresence mode="wait" initial={false}>
          {showOnboarding ? (
            <motion.div
              key="onboarding"
              className="h-full w-full"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1, transition: { duration: 0.3 } }}
              exit={{
                opacity: 0,
                scale: 0.985,
                transition: { duration: 0.28, ease: [0.4, 0, 1, 1] },
              }}
            >
              {/* initial={false} above would otherwise block every nested mount animation. */}
              <PresenceContext.Provider value={null}>
                <Suspense
                  fallback={
                    <div className="h-full w-full bg-surface-secondary" />
                  }
                >
                  <OnboardingScreen onComplete={() => {}} />
                </Suspense>
              </PresenceContext.Provider>
            </motion.div>
          ) : (
            <motion.div
              key="home"
              className={`h-full w-full${homeEnters ? " home-enter" : ""}`}
              exit={{ opacity: 0, transition: { duration: 0.22 } }}
            >
              <PresenceContext.Provider value={null}>
                <Suspense fallback={null}>
                  <Home />
                </Suspense>
              </PresenceContext.Provider>
            </motion.div>
          )}
        </AnimatePresence>
        <Suspense fallback={null}>
          <AneCompileOverlay />
        </Suspense>
      </div>
    </MotionConfig>
  );
}

export default function SettingsWindow() {
  return (
    <QueryClientProvider client={queryClient}>
      <QuerySyncBridge />
      <SettingsContent />
    </QueryClientProvider>
  );
}
