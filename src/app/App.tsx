import { lazy, Suspense, useState, useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "./App.css";

const SettingsWindow = lazy(() => import("./SettingsWindow"));
const LiveWindow = lazy(() => import("./LiveWindow"));

function App() {
  const [windowLabel] = useState(() => getCurrentWindow().label);

  useEffect(() => {
    const handleContextMenu = (event: MouseEvent) => {
      event.preventDefault();
    };
    document.addEventListener("contextmenu", handleContextMenu);
    return () => document.removeEventListener("contextmenu", handleContextMenu);
  }, []);

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
    return (
      <Suspense
        fallback={
          <div className="settings-view h-screen w-screen overflow-hidden bg-surface-secondary" />
        }
      >
        <SettingsWindow />
      </Suspense>
    );
  }

  return (
    <Suspense fallback={null}>
      <LiveWindow />
    </Suspense>
  );
}

export default App;
