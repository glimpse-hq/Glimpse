import React, { useEffect, useState, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import DotMatrix from "./components/DotMatrix";
import type { ToastType, ToastPayload } from "./types";

interface ToastState extends ToastPayload {
  isLeaving: boolean;
}

const COLORS: Record<ToastType, { border: string; dot: string }> = {
  error: { border: "border-red-500/40", dot: "bg-red-500" },
  info: { border: "border-blue-500/30", dot: "bg-blue-400" },
  success: { border: "border-emerald-500/30", dot: "bg-emerald-400" },
  warning: { border: "border-amber-500/40", dot: "bg-amber-400" },
  update: { border: "border-violet-500/40", dot: "bg-violet-400" },
  celebration: { border: "border-amber-500/30", dot: "bg-amber-400" },
};

const TwinklingGrid = React.memo(({ variant = "cloud" }: { variant?: "cloud" | "accent" }) => {
  const color = variant === "accent" ? "var(--color-accent)" : "var(--color-cloud)";
  const animationName = variant === "accent" ? "twinkle-accent" : "twinkle";
  
  const dots = React.useMemo(() => {
    const cols = 50;
    const rows = 12;
    const gap = 6;
    const size = 2;

    const items = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (Math.random() > 0.4) continue;

        const delay = Math.random() * 5;
        const duration = 2 + Math.random() * 4;

        items.push(
          <div
            key={`${r}-${c}`}
            className="absolute rounded-full"
            style={{
              left: c * (gap + size),
              top: r * (gap + size),
              width: size,
              height: size,
              backgroundColor: color,
              opacity: 0.15,
              animation: `${animationName} ${duration}s ease-in-out infinite`,
              animationDelay: `-${delay}s`,
            }}
          />
        );
      }
    }
    return items;
  }, [color, animationName]);

  return <div className="absolute inset-0 overflow-hidden opacity-60 pointer-events-none">{dots}</div>;
});

const ToastOverlay: React.FC = () => {
  const [toast, setToast] = useState<ToastState | null>(null);
  const [isRetrying, setIsRetrying] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dismissAnimationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastRef = useRef<ToastState | null>(null);

  useEffect(() => {
    toastRef.current = toast;
  }, [toast]);

  const closeAll = async () => {
    try {
      await invoke("toast_dismissed");
      await getCurrentWindow().hide();
    } catch (e) {
      console.error("closeAll failed:", e);
    }
  };

  const dismiss = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (dismissAnimationTimerRef.current) {
      clearTimeout(dismissAnimationTimerRef.current);
    }
    setToast((t) => (t ? { ...t, isLeaving: true } : null));
    dismissAnimationTimerRef.current = setTimeout(async () => {
      dismissAnimationTimerRef.current = null;
      setToast(null);
      try {
        await invoke("toast_dismissed");
      } catch { /* ignore */ }
      await getCurrentWindow().hide();
    }, 120);
  };

  const dismissWithCleanup = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setToast(null);
    closeAll();
  };

  const handleClose = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dismissWithCleanup();
  };

  const handleRetry = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!toast?.retryId) return;
    setIsRetrying(true);
    try {
      await invoke("retry_transcription", { id: toast.retryId });
      // Don't dismiss - the transcription runs async and will show a new toast
      // (either success, error, or quota exceeded) which replaces this one
    } catch (err) {
      console.error("Retry failed:", err);
      setIsRetrying(false);
      setToast(prev => prev ? {
        ...prev,
        message: typeof err === "string" ? err : "Retry failed. Please try again.",
        type: "error",
      } : null);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && toast) {
        e.preventDefault();
        dismissWithCleanup();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toast]);

  useEffect(() => {
    const unsub1 = listen<ToastPayload>("toast:show", async (ev) => {
      try {
        await getCurrentWindow().show();
        await getCurrentWindow().setFocus();
      } catch (err) {
        console.error("Failed to show toast window:", err);
      }

      if (timerRef.current) clearTimeout(timerRef.current);
      if (dismissAnimationTimerRef.current) {
        clearTimeout(dismissAnimationTimerRef.current);
        dismissAnimationTimerRef.current = null;
      }
      setToast({ ...ev.payload, isLeaving: false });
      setIsRetrying(false);

      const durations: Record<ToastType, number> = {
        error: 0,
        info: 3000,
        success: 2000,
        warning: 5000,
        update: 0,
        celebration: 6000,
      };
      const autoDismiss = ev.payload.autoDismiss !== false;
      const dur = ev.payload.duration ?? durations[ev.payload.type];
      if (dur > 0 && autoDismiss) {
        timerRef.current = setTimeout(dismiss, dur);
      }
    });

    const unsub2 = listen("toast:hide", () => dismiss());
    const unsub3 = listen("recording:start", async () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      if (dismissAnimationTimerRef.current) {
        clearTimeout(dismissAnimationTimerRef.current);
        dismissAnimationTimerRef.current = null;
      }
      if (toastRef.current) {
        setToast(null);
        try {
          await invoke("toast_dismissed");
        } catch { /* ignore */ }
        await getCurrentWindow().hide();
      }
    });

    return () => {
      unsub1.then((u) => u());
      unsub2.then((u) => u());
      unsub3.then((u) => u());
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  if (!toast) return null;

  const colors = COLORS[toast.type];
  const showRetry = toast.retryId && toast.mode === "cloud";

  const handleBackgroundClick = () => {
    dismissWithCleanup();
  };

  return (
    <div
      className="fixed inset-0 flex flex-col justify-end items-center pb-6"
      onClick={handleBackgroundClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleBackgroundClick();
        }
      }}
      role="button"
      tabIndex={0}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div
        className={`
          w-fit max-w-[420px] max-h-[140px] bg-black rounded-2xl border px-4 py-3 overflow-y-auto overflow-x-hidden
          ${colors.border}
          ${toast.isLeaving ? "animate-toast-out" : "animate-toast-in"}
        `}
        onClick={(e) => e.stopPropagation()}
        role="alert"
      >
        {toast.type === "celebration" && <TwinklingGrid variant="cloud" />}
        {toast.type === "update" && <TwinklingGrid variant="accent" />}
        <button
          type="button"
          onClick={handleClose}
          aria-label="Close notification"
          className="absolute top-2 right-2 w-5 h-5 flex items-center justify-center 
                     ui-color-gray-500 ui-hover-on-solid ui-text-body-sm transition-colors z-10"
        >
          <span aria-hidden="true">✕</span>
        </button>

        <div className="flex items-start gap-3 pr-5">
          {toast.type === "update" ? (
            <div className="mt-0.5 shrink-0">
              <DotMatrix
                rows={2}
                cols={2}
                activeDots={[0, 1, 2, 3]}
                dotSize={4}
                gap={2}
                color="var(--color-accent)"
                aria-hidden="true"
              />
            </div>
          ) : (
            <div className={`w-2 h-2 rounded-full mt-1 shrink-0 ${colors.dot} ${toast.type === "error" ? "animate-pulse" : ""}`} />
          )}
          <div className="flex-1 min-w-0">
            {toast.type === "update" && (
              <p className="ui-text-label ui-color-accent font-medium mb-0.5">GLIMPSE</p>
            )}
            <p className="ui-text-body ui-color-gray-200 leading-relaxed break-words">{toast.message}</p>
            {showRetry && (
              <button
                type="button"
                onClick={handleRetry}
                disabled={isRetrying}
                className="mt-2 ui-text-body-sm ui-color-info-strong ui-hover-on-solid ui-disabled-gray-600 transition-colors"
              >
                {isRetrying ? "Retrying…" : "Retry transcription"}
              </button>
            )}
            {toast.action && toast.actionLabel && (
              <button
                type="button"
                onClick={async (e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  try {
                    await invoke(toast.action!);
                    dismissWithCleanup();
                  } catch (err) {
                    console.error("Action failed:", err);
                  }
                }}
                className={`mt-2 ui-text-body-sm ${toast.type === "update" ? "ui-color-accent" : "ui-color-info-strong"} ui-hover-on-solid transition-colors block font-medium`}
              >
                {toast.actionLabel} →
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ToastOverlay;
