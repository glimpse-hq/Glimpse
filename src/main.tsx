import React from "react";
import ReactDOM from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import App from "./app/App";
import { AppProviders } from "./app/providers";
import { detectAppPlatform } from "./platform/service";
import {
  parseTextSizeMode,
  resolveTextScale,
  TEXT_SIZE_MODE_STORAGE_KEY,
} from "./shared/lib/textSize";

type CrashSource = "render" | "window_error" | "unhandled_rejection";

const reportedCrashes = new Set<string>();

const errorKind = (error: unknown): string => {
  if (!(error instanceof Error)) return "unknown";
  return [
    "Error",
    "TypeError",
    "RangeError",
    "ReferenceError",
    "SyntaxError",
  ].includes(error.name)
    ? error.name
    : "unknown";
};

const crashFingerprint = (error: unknown, componentStack = ""): string => {
  const input =
    error instanceof Error
      ? `${error.name}\n${error.stack ?? ""}\n${componentStack}`
      : `unknown\n${componentStack}`;
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
};

const reportFrontendCrash = (
  source: CrashSource,
  error: unknown,
  componentStack = "",
) => {
  const fingerprint = crashFingerprint(error, componentStack);
  const dedupeKey = `${source}:${fingerprint}`;
  if (reportedCrashes.has(dedupeKey)) return;
  reportedCrashes.add(dedupeKey);
  void invoke("report_frontend_crash", {
    windowLabel: getCurrentWindow().label,
    source,
    errorKind: errorKind(error),
    fingerprint,
  }).catch(() => {});
};

class CrashBoundary extends React.Component<
  React.PropsWithChildren,
  { crashed: boolean }
> {
  state = { crashed: false };

  static getDerivedStateFromError() {
    return { crashed: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    reportFrontendCrash("render", error, info.componentStack ?? "");
  }

  render() {
    return this.state.crashed ? null : this.props.children;
  }
}

window.addEventListener("error", (event) => {
  if (event.error instanceof Error) {
    reportFrontendCrash("window_error", event.error);
  }
});
window.addEventListener("unhandledrejection", (event) => {
  if (event.reason instanceof Error) {
    reportFrontendCrash("unhandled_rejection", event.reason);
  }
});

const applyInitialTextScale = () => {
  if (getCurrentWindow().label !== "settings") return;

  const mode = parseTextSizeMode(
    localStorage.getItem(TEXT_SIZE_MODE_STORAGE_KEY),
  );
  document.documentElement.style.setProperty(
    "--ui-text-scale",
    resolveTextScale(mode, detectAppPlatform()),
  );
};

applyInitialTextScale();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <CrashBoundary>
      <AppProviders>
        <App />
      </AppProviders>
    </CrashBoundary>
  </React.StrictMode>,
);
