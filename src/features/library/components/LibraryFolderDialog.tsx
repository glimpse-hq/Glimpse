import { useLingui } from "@lingui/react/macro";
import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { useFocusTrap } from "../../../shared/hooks/useFocusTrap";

export type FolderDialogState =
  { mode: "new"; itemId?: string } | { mode: "rename"; folder: string };

const LibraryFolderDialog = ({
  state,
  onCancel,
  onSubmit,
}: {
  state: FolderDialogState | null;
  onCancel: () => void;
  onSubmit: (name: string) => void;
}) => {
  const { t } = useLingui();
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, state !== null, onCancel);

  return createPortal(
    <AnimatePresence>
      {state && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 px-6 backdrop-blur-xs"
          onClick={(event) => {
            event.stopPropagation();
            onCancel();
          }}
        >
          <motion.div
            ref={dialogRef}
            initial={{ scale: 0.96, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.96, opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="w-full max-w-sm rounded-2xl border border-border-primary bg-surface-tertiary p-5 ui-shadow-modal-deep"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="library-folder-title"
          >
            <FolderNameForm
              key={state.mode === "rename" ? state.folder : "new"}
              initialName={state.mode === "rename" ? state.folder : ""}
              title={
                state.mode === "rename"
                  ? t({
                      id: "library.folder.rename_title",
                      message: "Rename Folder",
                    })
                  : t({ id: "library.folder.new_title", message: "New Folder" })
              }
              submitLabel={
                state.mode === "rename"
                  ? t({ id: "library.folder.rename_save", message: "Rename" })
                  : t({ id: "library.folder.create", message: "Create" })
              }
              onCancel={onCancel}
              onSubmit={onSubmit}
            />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
};

const FolderNameForm = ({
  initialName,
  title,
  submitLabel,
  onCancel,
  onSubmit,
}: {
  initialName: string;
  title: string;
  submitLabel: string;
  onCancel: () => void;
  onSubmit: (name: string) => void;
}) => {
  const { t } = useLingui();
  const [name, setName] = useState(initialName);
  const trimmed = name.trim();
  const submit = () => {
    if (trimmed) onSubmit(trimmed);
  };
  return (
    <>
      <p
        id="library-folder-title"
        className="ui-text-body-lg font-semibold text-content-primary"
      >
        {title}
      </p>
      <input
        value={name}
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            submit();
          }
        }}
        onFocus={(event) => event.target.select()}
        aria-label={title}
        className="mt-4 h-10 w-full rounded-lg border border-border-primary bg-[var(--color-bg-surface)] px-3 ui-text-body text-content-primary outline-hidden focus:border-border-hover"
        autoFocus
      />
      <div className="mt-4 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg px-3 py-2 ui-text-body-sm font-medium text-content-muted transition-colors hover:text-content-primary"
        >
          {t({ id: "library.folder.cancel", message: "Cancel" })}
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={!trimmed}
          className="ui-button-primary rounded-lg px-4 py-2 ui-text-body-sm disabled:opacity-50"
        >
          {submitLabel}
        </button>
      </div>
    </>
  );
};

export default LibraryFolderDialog;
