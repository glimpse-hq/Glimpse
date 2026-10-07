import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  AnimatePresence,
  MotionConfig,
  motion,
  PresenceContext,
} from "framer-motion";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { licenseKeys } from "../features/license/queries";
import { useTextScale, useTheme } from "../shared/hooks/useAppearance";
import { modelKeys } from "../features/settings/models-queries";
import { getSettings } from "../features/settings/api";
import { settingsKeys, useSettings } from "../features/settings/queries";
import { transcriptionKeys } from "../features/transcriptions/queries";
import { updateKeys } from "../features/updates/queries";
import type { LicenseState } from "../shared/types/license";
import type { StoredSettings } from "../types";

const loadHome = () => import("../Home");
const Home = lazy(loadHome);
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

// Fetch settings and the Home chunk in parallel.
void queryClient.prefetchQuery({
  queryKey: settingsKeys.detail(),
  queryFn: getSettings,
});
loadHome().catch(() => {});

// Shows Home anyway if its first screen never reports ready.
const HOME_READY_TIMEOUT_MS = 2000;

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
    // The backend may have just activated the key from the link. Onboarding
    // has no Home mounted to pick that up.
    register("license:checkout-returned", () => {
      queryClient.invalidateQueries({ queryKey: licenseKeys.state() });
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
    register("permissions:accessibility-granted", () => {
      queryClient.setQueryData(settingsKeys.accessibility(), true);
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
  useTextScale();
  useTheme(settings?.theme_mode ?? null, isLoading);

  // Home stays invisible until its first screen has its data and fonts, so it
  // appears in one piece instead of filling in.
  const [homeReady, setHomeReady] = useState(false);
  const revealHome = useCallback(() => {
    void Promise.allSettled([
      document.fonts.load("400 1em Satoshi"),
      document.fonts.load("700 1em Satoshi"),
    ]).then(() => setHomeReady(true));
  }, []);
  useEffect(() => {
    const timeout = window.setTimeout(
      () => setHomeReady(true),
      HOME_READY_TIMEOUT_MS,
    );
    return () => window.clearTimeout(timeout);
  }, []);

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
              className={`h-full w-full${homeEnters ? " home-enter" : ""}${
                homeReady || homeEnters ? "" : " invisible"
              }`}
              exit={{ opacity: 0, transition: { duration: 0.22 } }}
            >
              <PresenceContext.Provider value={null}>
                <Suspense fallback={null}>
                  <Home onReady={revealHome} />
                </Suspense>
              </PresenceContext.Provider>
            </motion.div>
          )}
        </AnimatePresence>
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
