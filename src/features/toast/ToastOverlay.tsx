import { useLingui } from "@lingui/react/macro";
import React, { useEffect, useState, useRef } from "react";
import { useCopyToClipboard } from "../../shared/hooks/useCopyToClipboard";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Check, Copy } from "@phosphor-icons/react";
import DotMatrix from "../../shared/ui/DotMatrix";
import type { ToastType, ToastPayload } from "../../types";

interface ToastState extends ToastPayload {
  isLeaving: boolean;
}

const WINDOW_INSET_X = 8;
const WINDOW_INSET_TOP = 16;
const WINDOW_INSET_BOTTOM = 24;

const DURATIONS: Record<ToastType, number> = {
  error: 18000,
  info: 3000,
  success: 2000,
  warning: 5000,
  update: 0,
  celebration: 6000,
};

const COLORS: Record<ToastType, { border: string; dot: string }> = {
  error: { border: "border-red-500/40", dot: "bg-red-500" },
  info: { border: "border-blue-500/30", dot: "bg-blue-400" },
  success: { border: "border-emerald-500/30", dot: "bg-emerald-400" },
  warning: { border: "border-amber-500/40", dot: "bg-amber-400" },
  update: { border: "border-violet-500/40", dot: "bg-violet-400" },
  celebration: { border: "border-amber-500/30", dot: "bg-amber-400" },
};

const TwinklingGrid = React.memo(
  ({ variant = "cloud" }: { variant?: "cloud" | "accent" }) => {
    const color =
      variant === "accent" ? "var(--color-accent)" : "var(--color-cloud)";
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
            />,
          );
        }
      }
      return items;
    }, [color, animationName]);

    return (
      <div
        aria-hidden="true"
        className="twinkling-grid absolute inset-0 overflow-hidden opacity-60 pointer-events-none"
      >
        {dots}
      </div>
    );
  },
);

const ToastOverlay: React.FC = () => {
  const { t } = useLingui();
  const [toast, setToast] = useState<ToastState | null>(null);
  const { copied, copy, reset: resetCopied } = useCopyToClipboard(1500);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dismissAnimationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const toastRef = useRef<ToastState | null>(null);
  // Bumped per shown toast, so a slow action can't touch a newer one.
  const toastGenerationRef = useRef(0);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    toastRef.current = toast;
  }, [toast]);

  // Fit the window to the card so the empty area stays click-through.
  useEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    const observer = new ResizeObserver(() => {
      invoke("resize_toast_window", {
        width: Math.ceil(card.offsetWidth + WINDOW_INSET_X * 2),
        height: Math.ceil(
          card.offsetHeight + WINDOW_INSET_TOP + WINDOW_INSET_BOTTOM,
        ),
      }).catch(() => {});
    });
    observer.observe(card);
    return () => observer.disconnect();
  }, [toast]);

  const clearTimers = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (dismissAnimationTimerRef.current) {
      clearTimeout(dismissAnimationTimerRef.current);
      dismissAnimationTimerRef.current = null;
    }
  };

  const hideNow = async () => {
    clearTimers();
    setToast(null);
    resetCopied();
    await invoke("toast_dismissed").catch((err) =>
      console.error("toast_dismissed failed:", err),
    );
    await getCurrentWindow()
      .hide()
      .catch((err) => console.error("Hiding the toast window failed:", err));
  };

  const dismiss = () => {
    clearTimers();
    setToast((t) => (t ? { ...t, isLeaving: true } : null));
    dismissAnimationTimerRef.current = setTimeout(() => void hideNow(), 120);
  };

  const handleClose = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    void hideNow();
  };

  const handleCopy = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!toast) return;

    const copyText = [
      toast.type !== "update" ? null : toast.title,
      toast.message,
    ]
      .filter(Boolean)
      .join("\n");

    copy(copyText);
  };

  const handleToastAction = async (action: string) => {
    const generation = toastGenerationRef.current;
    try {
      await invoke(action, toast?.actionArgs ?? undefined);
      // copy_last_transcription replaces this toast with its own "Copied" toast,
      // so dismissing here would race and hide that confirmation.
      if (
        action !== "copy_last_transcription" &&
        generation === toastGenerationRef.current
      ) {
        void hideNow();
      }
    } catch (err) {
      console.error("Action failed:", err);
      if (generation !== toastGenerationRef.current) return;
      // The error gets its own full display time, not the old toast's deadline.
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(dismiss, DURATIONS.error);
      setToast((prev) =>
        prev
          ? {
              ...prev,
              message: t({
                id: "toast.action_failed",
                message: "That didn't work. Try again.",
              }),
              type: "error",
            }
          : null,
      );
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && toast) {
        e.preventDefault();
        void hideNow();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toast]);

  useEffect(() => {
    const unsub1 = listen<ToastPayload>("toast:show", (ev) => {
      clearTimers();
      toastGenerationRef.current += 1;
      setToast({ ...ev.payload, isLeaving: false });
      resetCopied();

      const autoDismiss = ev.payload.autoDismiss !== false;
      const dur = ev.payload.duration ?? DURATIONS[ev.payload.type];
      if (dur > 0 && autoDismiss) {
        timerRef.current = setTimeout(dismiss, dur);
      }
    });

    const unsub2 = listen("toast:hide", () => dismiss());
    const unsub3 = listen("recording:start", () => {
      if (toastRef.current) void hideNow();
    });

    return () => {
      unsub1.then((u) => u());
      unsub2.then((u) => u());
      unsub3.then((u) => u());
      clearTimers();
    };
  }, []);

  if (!toast) return null;

  const colors = COLORS[toast.type];
  const showCopy = toast.type === "error";
  const copySecondary = toast.secondaryAction === "copy_last_transcription";

  const handleBackgroundClick = () => {
    void hideNow();
  };

  return (
    <div
      className="fixed inset-0 flex flex-col justify-end items-center pb-6"
      onClick={handleBackgroundClick}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div
        className={`
          relative w-fit max-w-[420px] max-h-[140px] bg-black rounded-2xl border px-4 py-3 overflow-y-auto overflow-x-hidden
          ${colors.border}
          ${toast.isLeaving ? "animate-toast-out" : "animate-toast-in"}
        `}
        onClick={(e) => e.stopPropagation()}
        role={toast.type === "error" ? "alert" : "status"}
        ref={cardRef}
      >
        {toast.type === "celebration" && <TwinklingGrid variant="cloud" />}
        {toast.type === "update" && <TwinklingGrid variant="accent" />}
        <div className="absolute top-2 right-2 bottom-2 flex flex-col items-center justify-between z-10">
          <button
            type="button"
            onClick={handleClose}
            aria-label={t({
              id: "toast.close",
              message: "Close notification",
            })}
            className="w-5 h-5 flex items-center justify-center ui-color-gray-500 ui-hover-on-solid ui-text-body-sm transition-colors"
          >
            <span aria-hidden="true">✕</span>
          </button>
          {showCopy && (
            <button
              type="button"
              onClick={handleCopy}
              className="w-5 h-5 flex items-center justify-center rounded-md ui-color-gray-500 ui-hover-on-solid transition-colors"
              title={
                copied
                  ? t({
                      id: "toast.copied",
                      message: "Copied",
                    })
                  : t({
                      id: "toast.copy_message",
                      message: "Copy message",
                    })
              }
              aria-label={
                copied
                  ? t({
                      id: "toast.copied",
                      message: "Copied",
                    })
                  : t({
                      id: "toast.copy_message",
                      message: "Copy message",
                    })
              }
            >
              {copied ? (
                <Check size={12} aria-hidden="true" />
              ) : (
                <Copy size={12} aria-hidden="true" />
              )}
            </button>
          )}
        </div>

        <div className="flex items-start gap-3 pr-10">
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
            <div
              aria-hidden="true"
              className={`w-2 h-2 rounded-full mt-1 shrink-0 ${colors.dot} ${toast.type === "error" ? "animate-pulse" : ""}`}
            />
          )}
          <div className="flex-1 min-w-0">
            {toast.type === "update" && (
              <p className="ui-text-label ui-color-accent font-medium mb-0.5">
                GLIMPSE
              </p>
            )}
            <p className="ui-text-body ui-color-gray-200 leading-relaxed break-words">
              {toast.message}
            </p>
            {((toast.action && toast.actionLabel) ||
              (toast.secondaryAction && toast.secondaryActionLabel)) && (
              <div
                className={`mt-2 flex items-center gap-4 ${copySecondary ? "" : "justify-between"}`}
              >
                {toast.action && toast.actionLabel && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      void handleToastAction(toast.action!);
                    }}
                    className={`ui-text-body-sm ${toast.type === "update" ? "ui-color-accent" : "ui-color-info-strong"} ui-hover-on-solid transition-colors font-medium`}
                  >
                    {toast.actionLabel} <span aria-hidden="true">→</span>
                  </button>
                )}
                {!copySecondary && (
                  <span aria-hidden="true" className="flex-1" />
                )}
                {toast.secondaryAction && toast.secondaryActionLabel && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      void handleToastAction(toast.secondaryAction!);
                    }}
                    className={`ui-text-body-sm transition-colors font-medium ${copySecondary ? "inline-flex items-center gap-1 ui-color-info-strong ui-hover-on-solid" : "ui-color-error-soft ui-hover-error-strong"}`}
                  >
                    {copySecondary && <Copy size={12} aria-hidden="true" />}
                    {toast.secondaryActionLabel}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ToastOverlay;
