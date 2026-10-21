import { useEffect, useState } from "react";
import { useLingui } from "@lingui/react/macro";
import { AnimatePresence, motion } from "framer-motion";
import { Check } from "@phosphor-icons/react";
import { downloadFailureLabel } from "../../shared/lib/modelStats";
import type { DownloadEvent } from "../../types";

export type ModelDownload = {
  key: string;
  name: string;
  state: DownloadEvent | null;
  onRetry: () => void;
};

const READY_VISIBLE_MS = 2400;

// Dots like the step indicator at the top, one per download: the running one
// stretches and fills, finished ones fill in solid. The label below names the
// running one and lines up with Back.
export function ModelDownloadStatus({
  downloads,
}: {
  downloads: ModelDownload[];
}) {
  const current =
    downloads.find((download) => download.state?.status === "error") ??
    downloads.find((download) => download.state?.status === "downloading") ??
    downloads.find((download) => download.state?.status !== "complete");
  const allReady = !current;
  const labelDownload = current ?? downloads[downloads.length - 1];

  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    if (!allReady) return;
    const timer = window.setTimeout(() => setDismissed(true), READY_VISIBLE_MS);
    return () => window.clearTimeout(timer);
  }, [allReady]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: dismissed ? 0 : 1 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
      className="pointer-events-none absolute right-6 bottom-6 flex max-w-[260px] flex-col items-end gap-2 ui-text-body-sm text-content-muted"
    >
      <div className="flex items-center gap-1.5" aria-hidden="true">
        {downloads.map((download) => (
          <DownloadDot
            key={download.key}
            state={download.state}
            active={download.key === current?.key}
          />
        ))}
      </div>
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={allReady ? "ready" : current.key}
          role="status"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="flex h-5 min-w-0 items-center gap-2"
        >
          {labelDownload ? (
            <DownloadLabel download={labelDownload} allReady={allReady} />
          ) : null}
        </motion.span>
      </AnimatePresence>
    </motion.div>
  );
}

function DownloadLabel({
  download,
  allReady,
}: {
  download: ModelDownload;
  allReady: boolean;
}) {
  const { t } = useLingui();
  const { state } = download;
  const error = state?.status === "error" ? state : undefined;
  const verifying =
    state?.status === "downloading" && "verifying" in state && state.verifying;

  return (
    <>
      <span className="min-w-0 truncate">
        {allReady
          ? t({ id: "onboarding.downloads.all_ready", message: "Models ready" })
          : error
            ? t({
                id: "onboarding.downloads.failed",
                message: "Download failed",
              })
            : download.name}
      </span>
      <span className="flex shrink-0 tabular-nums">
        {allReady ? (
          <Check size={13} weight="bold" aria-hidden="true" />
        ) : error ? (
          <button
            type="button"
            onClick={download.onRetry}
            title={
              error.reason && error.reason !== "failed"
                ? downloadFailureLabel(error.reason)
                : error.message
            }
            className="pointer-events-auto text-content-secondary underline-offset-4 hover:underline"
          >
            {t({ id: "onboarding.download_status.retry", message: "Retry" })}
          </button>
        ) : state?.status === "downloading" && !verifying ? (
          `${Math.round(state.percent)}%`
        ) : null}
      </span>
    </>
  );
}

function DownloadDot({
  state,
  active,
}: {
  state: DownloadEvent | null;
  active: boolean;
}) {
  const complete = state?.status === "complete";
  const error = state?.status === "error";
  const percent = state?.status === "downloading" ? state.percent : 0;

  return (
    <motion.span
      className="relative block h-1.5 overflow-hidden rounded-full"
      initial={false}
      animate={{ width: active ? 20 : 6 }}
      transition={{ duration: 0.25 }}
    >
      <span
        className={`absolute inset-0 transition-colors duration-300 ${
          complete
            ? "bg-content-primary"
            : error
              ? "bg-error"
              : "bg-content-primary opacity-25"
        }`}
      />
      {active && !error ? (
        <span
          className="absolute inset-y-0 left-0 rounded-full bg-content-primary transition-[width] duration-300 ease-out"
          style={{ width: `${percent}%` }}
        />
      ) : null}
    </motion.span>
  );
}
