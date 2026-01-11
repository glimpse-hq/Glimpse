import { useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen, type UnlistenFn } from "@tauri-apps/api/event";
import { createJwt, getCurrentUser } from "../lib/auth";
import { useCloudSyncEnabled } from "./useCloudSyncEnabled";

const CLOUD_FUNCTION_URL = import.meta.env.VITE_CLOUD_TRANSCRIPTION_URL;
const JWT_REFRESH_INTERVAL = 10 * 60 * 1000;
const JWT_MAX_AGE_MS = 12 * 60 * 1000;
const JWT_REFRESH_BACKOFF_BASE_MS = 5000;
const JWT_REFRESH_BACKOFF_MAX_MS = 5 * 60 * 1000;
const JWT_REFRESH_BACKOFF_JITTER = 0.2;

export function useCloudCredentials() {
    const { cloudSyncEnabled } = useCloudSyncEnabled();
    const jwtRefreshInterval = useRef<ReturnType<typeof setInterval> | null>(null);
    const hadAuthError = useRef(false);
    const refreshInFlight = useRef<Promise<void> | null>(null);
    const lastRefreshTime = useRef<number>(0);
    const jwtCreatedAt = useRef<number>(0);
    const refreshFailures = useRef(0);
    const refreshBackoffTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

    const isJwtStale = useCallback(() => {
        if (jwtCreatedAt.current === 0) return true;
        return Date.now() - jwtCreatedAt.current > JWT_MAX_AGE_MS;
    }, []);

    const setupCloudCredentials = useCallback(async (force = false) => {
        if (refreshInFlight.current) {
            return refreshInFlight.current;
        }

        const now = Date.now();
        const DEBOUNCE_MS = 5000;
        if (!force && now - lastRefreshTime.current < DEBOUNCE_MS) {
            return;
        }
        lastRefreshTime.current = now;

        const clearRefreshBackoff = () => {
            refreshFailures.current = 0;
            if (refreshBackoffTimeout.current) {
                clearTimeout(refreshBackoffTimeout.current);
                refreshBackoffTimeout.current = null;
            }
        };

        const scheduleRefreshRetry = () => {
            refreshFailures.current += 1;
            const exponentialDelay = Math.min(
                JWT_REFRESH_BACKOFF_BASE_MS * 2 ** (refreshFailures.current - 1),
                JWT_REFRESH_BACKOFF_MAX_MS
            );
            const jitterMultiplier = 1 + (Math.random() * 2 - 1) * JWT_REFRESH_BACKOFF_JITTER;
            const delay = Math.max(0, Math.round(exponentialDelay * jitterMultiplier));

            if (refreshBackoffTimeout.current) {
                clearTimeout(refreshBackoffTimeout.current);
            }
            refreshBackoffTimeout.current = setTimeout(() => {
                refreshBackoffTimeout.current = null;
                setupCloudCredentials(true);
            }, delay);
        };

        const refreshPromise = (async () => {
            try {
                const user = await getCurrentUser();
                if (!user) {
                    await invoke("clear_cloud_credentials");
                    clearRefreshBackoff();
                    return;
                }

                const isSubscriber = user.labels?.includes("cloud") || false;
                const isTester = user.labels?.includes("tester") || false;

                if (!CLOUD_FUNCTION_URL) {
                    await invoke("clear_cloud_credentials");
                    clearRefreshBackoff();
                    return;
                }

                const historySyncEnabled = cloudSyncEnabled;

                const jwt = await createJwt();
                await invoke("set_cloud_credentials", {
                    jwt: jwt.jwt,
                    functionUrl: CLOUD_FUNCTION_URL,
                    isSubscriber,
                    isTester,
                    historySyncEnabled,
                });
                jwtCreatedAt.current = Date.now();
                clearRefreshBackoff();

                if (hadAuthError.current) {
                    hadAuthError.current = false;
                    emit("auth:changed");
                }
            } catch {
                scheduleRefreshRetry();
            }
        })();

        refreshInFlight.current = refreshPromise;

        try {
            await refreshPromise;
        } finally {
            refreshInFlight.current = null;
        }
    }, [cloudSyncEnabled]);

    useEffect(() => {
        setupCloudCredentials(true);
    }, [cloudSyncEnabled, setupCloudCredentials]);

    useEffect(() => {
        let unlistenAuth: UnlistenFn | null = null;
        let unlistenAuthError: UnlistenFn | null = null;

        setupCloudCredentials();

        jwtRefreshInterval.current = setInterval(() => {
            setupCloudCredentials();
        }, JWT_REFRESH_INTERVAL);

        const handleVisibilityChange = () => {
            if (document.visibilityState === "visible") {
                setupCloudCredentials(isJwtStale());
            }
        };
        const handleWindowFocus = () => {
            setupCloudCredentials(isJwtStale());
        };

        window.addEventListener("focus", handleWindowFocus);
        document.addEventListener("visibilitychange", handleVisibilityChange);

        listen("auth:changed", () => {
            setupCloudCredentials(true);
        }).then((fn) => {
            unlistenAuth = fn;
        });

        listen("cloud:auth-error", async () => {
            hadAuthError.current = true;
            await setupCloudCredentials(true);
        }).then((fn) => {
            unlistenAuthError = fn;
        });

        return () => {
            if (jwtRefreshInterval.current) {
                clearInterval(jwtRefreshInterval.current);
            }
            if (refreshBackoffTimeout.current) {
                clearTimeout(refreshBackoffTimeout.current);
            }
            window.removeEventListener("focus", handleWindowFocus);
            document.removeEventListener("visibilitychange", handleVisibilityChange);
            unlistenAuth?.();
            unlistenAuthError?.();
        };
    }, [setupCloudCredentials, isJwtStale]);

    return {
        refreshCredentials: setupCloudCredentials,
    };
}
