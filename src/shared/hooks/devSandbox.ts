// Hooks for `glimpse dev` in the screenshot sandbox (scripts/screenshots/run.mjs).
// DEV_SANDBOX is false in release builds, so everything below drops out of them.
import { useEffect, useEffectEvent } from "react";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import type { QueryClient } from "@tanstack/react-query";
import { MotionGlobalConfig } from "framer-motion";

export const DEV_SANDBOX =
  import.meta.env.DEV && import.meta.env.VITE_GLIMPSE_SANDBOX === "1";

type DevRequest = { token: string } & Record<string, unknown>;

// Requests are resent until answered, so each token runs once.
const handledTokens = new Set<string>();

function listenForRequests(
  event: string,
  handler: (request: DevRequest) => unknown,
): Promise<() => void> {
  return getCurrentWebviewWindow().listen<DevRequest>(event, ({ payload }) => {
    if (handledTokens.has(payload.token)) return;
    handledTokens.add(payload.token);
    void Promise.resolve()
      .then(() => handler(payload))
      .then(
        (result) =>
          emit("dev:reply", {
            ...(result as object | undefined),
            token: payload.token,
          }),
        (error: unknown) =>
          emit("dev:reply", { token: payload.token, error: String(error) }),
      );
  });
}

// React holds back suspended content for up to 300 ms after it loads.
const QUIET_MS = 400;
const SETTLE_TIMEOUT_MS = 10_000;

// rAF stops in a hidden webview; the timeout keeps the loop going anyway.
const nextFrame = () =>
  new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
    setTimeout(resolve, 50);
  });

const finite = (animation: Animation) =>
  animation.effect?.getComputedTiming().iterations !== Infinity;

// Waits for fonts, queries, images and finite animations, then for the DOM to
// stop changing. Endless animations are held on their first frame.
async function settle(queryClient: QueryClient | null) {
  await document.fonts.ready;
  await preloaded;
  let quietSince = performance.now();
  let reason = "";
  const observer = new MutationObserver((records) => {
    quietSince = performance.now();
    const target = records[0]?.target;
    const element = target instanceof Element ? target : target?.parentElement;
    reason = `DOM changes in <${element?.tagName.toLowerCase()} class="${element?.className}">`;
  });
  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    characterData: true,
  });
  const deadline = performance.now() + SETTLE_TIMEOUT_MS;
  try {
    while (performance.now() < deadline) {
      await nextFrame();
      const animations = document.getAnimations();
      for (const animation of animations) {
        if (!finite(animation) && animation.playState === "running") {
          animation.currentTime = 0;
          animation.pause();
        }
      }
      const fetching = queryClient
        ?.getQueryCache()
        .findAll({ fetchStatus: "fetching" })
        .map((query) => JSON.stringify(query.queryKey));
      const running = animations
        .filter((a) => finite(a) && a.playState === "running")
        .map((a) => (a as CSSAnimation).animationName ?? "animation");
      // Lazy images off screen never load.
      const loading = [...document.images].find(
        (image) => !image.complete && image.loading !== "lazy",
      );
      const busy = fetching?.length
        ? `fetching ${fetching.join(", ")}`
        : (queryClient?.isMutating() ?? 0) > 0
          ? "a mutation"
          : loading
            ? `loading ${loading.src}`
            : running.length
              ? `animating ${running.join(", ")}`
              : // Home stays invisible until its first screen is ready.
                document.querySelector(".settings-view > .invisible")
                ? "Home not revealed yet"
                : document.querySelector(".settings-view")?.textContent === ""
                  ? "window still empty"
                  : "";
      if (busy) {
        reason = busy;
        quietSince = performance.now();
      } else if (performance.now() - quietSince >= QUIET_MS) {
        await nextFrame();
        return { settled: true };
      }
    }
    return { settled: false, reason };
  } finally {
    observer.disconnect();
  }
}

let devQueryClient: QueryClient | null = null;
let preloaded: Promise<unknown> = Promise.resolve();

// Called once per window at startup.
export function installDevSandbox() {
  if (!DEV_SANDBOX) return;
  // Every animation lands on its last frame at once.
  MotionGlobalConfig.skipAnimations = true;
  void listenForRequests("dev:idle", () => settle(devQueryClient));
  void listen("dev:refetch", () => {
    void devQueryClient?.invalidateQueries();
  });
}

// The settings window also loads every lazy screen up front, since a quiet
// DOM can't tell that a chunk is still on its way.
export function registerDevQueryClient(queryClient: QueryClient) {
  if (!DEV_SANDBOX) return;
  devQueryClient = queryClient;
  const modules = import.meta.glob([
    "/src/**/*.tsx",
    "!/src/app/**",
    "!/src/main.tsx",
  ]);
  preloaded = Promise.allSettled(Object.values(modules).map((load) => load()));
}

function useDevRequestInSandbox(
  event: string,
  handler: (request: DevRequest) => unknown,
) {
  const onRequest = useEffectEvent(handler);
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;
    void listenForRequests(event, (request) => onRequest(request)).then(
      (fn) => {
        if (disposed) fn();
        else unlisten = fn;
      },
    );
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [event]);
}

export const useDevRequest: typeof useDevRequestInSandbox = DEV_SANDBOX
  ? useDevRequestInSandbox
  : () => {};
