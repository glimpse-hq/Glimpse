import { useLingui } from "@lingui/react/macro";
import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowUpRight } from "@phosphor-icons/react";
import { useQueryClient } from "@tanstack/react-query";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import * as asksApi from "../api";
import { askKeys, useAskPrompt } from "../queries";

type AskPromptProps = {
  active: boolean;
};

export default function AskPrompt({ active }: AskPromptProps) {
  const { t } = useLingui();
  const queryClient = useQueryClient();
  const { data } = useAskPrompt(active);
  const [resolving, setResolving] = useState(false);
  // The ask kind already marked seen; a later ask in the same session differs.
  const seenRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let unlisten: UnlistenFn | undefined;

    listen("ask:eligible", () => {
      if (!cancelled) {
        void queryClient.invalidateQueries({ queryKey: askKeys.prompt() });
      }
    })
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      })
      .catch((err) =>
        console.error("Failed to subscribe to ask:eligible", err),
      );

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [queryClient]);

  useEffect(() => {
    const kind = data?.kind;
    if (!active || !kind || seenRef.current === kind) return;

    let cancelled = false;
    const window = getCurrentWindow();

    const markIfVisible = async () => {
      if (cancelled || seenRef.current === kind) return;
      if (document.visibilityState !== "visible") return;
      if (!(await window.isVisible().catch(() => false))) return;
      seenRef.current = kind;
      void asksApi.markAskPromptSeen().catch(() => {
        seenRef.current = null;
      });
    };

    void markIfVisible();
    const onVisibility = () => void markIfVisible();
    document.addEventListener("visibilitychange", onVisibility);
    const unlistenFocus = window.onFocusChanged(() => void markIfVisible());

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibility);
      void unlistenFocus.then((fn) => fn());
    };
  }, [active, data?.kind]);

  const resolve = useCallback(
    async (action: asksApi.AskAction) => {
      setResolving(true);
      try {
        await asksApi.resolveAskPrompt(action);
        queryClient.setQueryData(askKeys.prompt(), { kind: null });
      } catch (err) {
        console.error(err);
        setResolving(false);
      }
    },
    [queryClient],
  );

  const askCopy = () => {
    switch (data?.kind) {
      case "review":
        return {
          title: t({
            id: "home.ask.review.title",
            message: "Rate Glimpse in the Microsoft Store?",
          }),
          accept: t({ id: "home.ask.review.answer", message: "Rate" }),
        };
      default:
        return {
          title: t({
            id: "home.ask.star.title",
            message: "Star Glimpse on GitHub?",
          }),
          accept: t({ id: "home.ask.star.answer", message: "Open GitHub" }),
        };
    }
  };
  const { title, accept } = askCopy();

  return (
    <AnimatePresence>
      {active && data?.kind && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 8 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
          className="fixed right-6 bottom-6 z-50 w-[300px] rounded-2xl border border-border-primary bg-surface-overlay p-4 shadow-lg"
        >
          <p className="ui-text-body-strong text-content-primary text-pretty">
            {title}
          </p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={resolving}
              onClick={() => void resolve("dismiss")}
              className="h-8 rounded-lg bg-[var(--surface-interactive-strong)] ui-text-body-sm ui-color-primary transition-opacity hover:opacity-80 disabled:opacity-50"
            >
              {t({ id: "home.survey.dismiss", message: "No thanks" })}
            </button>
            <button
              type="button"
              disabled={resolving}
              onClick={() => void resolve("answer")}
              className="ui-button-primary flex h-8 !shadow-none [:root[data-theme=light]_&]:bg-[#161618] [:root[data-theme=light]_&]:hover:opacity-90 items-center justify-center gap-1 rounded-lg ui-text-body-sm"
            >
              {accept}
              <ArrowUpRight size={12} aria-hidden="true" />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
