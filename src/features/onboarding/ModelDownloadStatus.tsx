import { useLingui } from "@lingui/react/macro";
import { AnimatePresence, motion } from "framer-motion";
import { Check } from "@phosphor-icons/react";
import type { DownloadEvent } from "../../types";

// Follows the user through the steps after the model step, so the
// download never has to block anything.
export function ModelDownloadStatus({
  state,
  onRetry,
}: {
  state: DownloadEvent | null;
  onRetry: () => void;
}) {
  const { t } = useLingui();
  const status = state?.status;
  const visible =
    status === "downloading" || status === "complete" || status === "error";
  const percent = Math.round(state?.percent ?? 0);
  const verifying = state && "verifying" in state && state.verifying;
  const fileIndex = state && "fileIndex" in state ? state.fileIndex : undefined;
  const fileCount = state && "fileCount" in state ? state.fileCount : undefined;
  const showFiles = Boolean(fileIndex && fileCount && fileCount > 1);

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-6 flex h-5 justify-center">
      <AnimatePresence initial={false} mode="wait">
        {visible ? (
          <motion.div
            key={status}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="pointer-events-auto flex items-center gap-2 ui-text-meta text-content-muted"
          >
            {status === "downloading" ? (
              <span className="tabular-nums">
                {verifying
                  ? t({
                      id: "onboarding.download_status.verifying",
                      message: "Checking model",
                    })
                  : showFiles
                    ? t({
                        id: "onboarding.download_status.downloading_files",
                        message: `Downloading model ${percent}% (${fileIndex}/${fileCount})`,
                      })
                    : t({
                        id: "onboarding.download_status.downloading",
                        message: `Downloading model ${percent}%`,
                      })}
              </span>
            ) : status === "complete" ? (
              <>
                <Check size={12} weight="bold" className="text-local" />
                {t({
                  id: "onboarding.download_status.ready",
                  message: "Model ready",
                })}
              </>
            ) : (
              <>
                {t({
                  id: "onboarding.download_status.failed",
                  message: "Model download failed",
                })}
                <button
                  type="button"
                  onClick={onRetry}
                  className="text-content-secondary underline-offset-4 hover:underline"
                >
                  {t({
                    id: "onboarding.download_status.retry",
                    message: "Retry",
                  })}
                </button>
              </>
            )}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
