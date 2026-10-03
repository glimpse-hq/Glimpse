import { useLingui } from "@lingui/react/macro";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Warning as AlertTriangle } from "@phosphor-icons/react";
import { detectAppPlatform } from "../../../platform/service";

const LibraryDeleteDialog = ({
  open,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) => {
  const { t } = useLingui();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const deleteRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    // Focus starts on Cancel, stays on the two buttons, and returns on close.
    const previous = document.activeElement as HTMLElement | null;
    cancelRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
      } else if (event.key === "Tab") {
        event.preventDefault();
        const next =
          document.activeElement === cancelRef.current
            ? deleteRef.current
            : cancelRef.current;
        next?.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      previous?.focus();
    };
  }, [open, onCancel]);

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-xs px-6"
          onClick={(event) => {
            event.stopPropagation();
            onCancel();
          }}
        >
          <motion.div
            initial={{ scale: 0.96, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.96, opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="w-full max-w-sm rounded-2xl border border-border-primary bg-surface-tertiary p-5 ui-shadow-modal-deep"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <div className="flex items-center gap-3 mb-3">
              <AlertTriangle
                size={20}
                className="ui-color-warning-strong shrink-0"
              />
              <div>
                <p className="ui-text-body-lg font-semibold text-content-primary">
                  {t({
                    id: "library.modal.delete_confirm.title",
                    message: "Delete this item?",
                  })}
                </p>
                <p className="ui-text-label text-content-disabled">
                  {detectAppPlatform() === "windows"
                    ? t({
                        id: "library.delete_confirm.recycle_bin",
                        message:
                          "The transcript is removed and the audio moves to the Recycle Bin.",
                      })
                    : t({
                        id: "library.delete_confirm.trash",
                        message:
                          "The transcript is removed and the audio moves to the Trash.",
                      })}
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button
                ref={cancelRef}
                onClick={onCancel}
                className="rounded-lg border border-border-secondary px-4 py-2 ui-text-body-sm font-medium text-content-secondary hover:border-border-hover transition-colors"
              >
                {t({
                  id: "library.modal.cancel",
                  message: "Cancel",
                })}
              </button>
              <button
                ref={deleteRef}
                onClick={onConfirm}
                className="rounded-lg bg-red-500/90 px-4 py-2 ui-text-body-sm font-semibold ui-color-on-solid hover:bg-red-500 transition-colors"
              >
                {t({
                  id: "library.modal.delete",
                  message: "Delete",
                })}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
};

export default LibraryDeleteDialog;
