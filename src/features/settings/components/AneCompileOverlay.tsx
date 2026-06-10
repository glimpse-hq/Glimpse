import { useEffect, useState } from "react";
import { useLingui } from "@lingui/react/macro";
import { motion, AnimatePresence } from "framer-motion";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import ActivityDots from "../../../shared/ui/ActivityDots";
import type { AneCompileEvent } from "../../../types";

export default function AneCompileOverlay() {
  const { t } = useLingui();
  const [label, setLabel] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let unlisten: UnlistenFn | undefined;
    listen<AneCompileEvent>("ane:compile", (event) => {
      if (cancelled) return;
      setLabel(event.payload.status === "start" ? event.payload.label : null);
    }).then((fn) => {
      if (cancelled) fn();
      else unlisten = fn;
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  return (
    <AnimatePresence>
      {label && (
        <motion.div
          key="ane-compile"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 px-6 backdrop-blur-xs"
        >
          <motion.div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="ane-compile-title"
            initial={{ scale: 0.97, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.97, opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="flex w-full max-w-sm flex-col items-center gap-3 rounded-2xl border border-border-primary bg-surface-tertiary px-8 py-7 text-center ui-shadow-modal-deep"
          >
            <ActivityDots color="var(--color-local)" dotSize={4} gap={3} />
            <h2
              id="ane-compile-title"
              className="ui-text-body-lg font-semibold text-content-primary"
            >
              {t({
                id: "ane_compile.title",
                message: "Optimizing for the Neural Engine",
              })}
            </h2>
            <p className="ui-text-body-sm text-content-muted">
              {t({
                id: "ane_compile.body",
                message: `macOS is compiling ${label} for the Apple Neural Engine. This happens once and can take a few minutes.`,
              })}
            </p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
