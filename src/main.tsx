import React from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import App from "./app/App";
import { AppProviders } from "./app/providers";
import { detectAppPlatform } from "./platform/service";
import {
  parseTextSizeMode,
  resolveTextScale,
  TEXT_SIZE_MODE_STORAGE_KEY,
} from "./shared/lib/textSize";

const applyInitialTextScale = () => {
  if (getCurrentWindow().label !== "settings") return;

  const mode = parseTextSizeMode(localStorage.getItem(TEXT_SIZE_MODE_STORAGE_KEY));
  document.documentElement.style.setProperty(
    "--ui-text-scale",
    resolveTextScale(mode, detectAppPlatform()),
  );
};

applyInitialTextScale();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <AppProviders>
      <App />
    </AppProviders>
  </React.StrictMode>,
);
