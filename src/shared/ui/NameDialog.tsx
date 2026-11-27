import { useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { useFocusTrap } from "../hooks/useFocusTrap";

type NameDialogProps = {
  open: boolean;
  title: string;
  submitLabel: string;
  cancelLabel: string;
  initialName?: string;
  // Grey text after the name, such as the extension a file will get.
  suffix?: (name: string) => string | null;
  onCancel: () => void;
  // A rejected promise keeps the dialog open with its message under the field.
  onSubmit: (name: string) => void | Promise<void>;
};

const NameDialog = ({ open, onCancel, ...form }: NameDialogProps) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useFocusTrap(dialogRef, open, onCancel);

  return createPortal(
    <AnimatePresence>
      {open && (
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
            aria-labelledby={titleId}
          >
            <NameForm
              key={form.initialName}
              titleId={titleId}
              onCancel={onCancel}
              {...form}
            />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
};

const NameForm = ({
  titleId,
  title,
  submitLabel,
  cancelLabel,
  initialName = "",
  suffix,
  onCancel,
  onSubmit,
}: Omit<NameDialogProps, "open"> & { titleId: string }) => {
  const [name, setName] = useState(initialName);
  const [error, setError] = useState<string | null>(null);
  const trimmed = name.trim();
  const shownSuffix = suffix?.(trimmed);
  const submit = () => {
    if (!trimmed) return;
    void Promise.resolve(onSubmit(trimmed)).catch((err) =>
      setError(String(err)),
    );
  };

  return (
    <>
      <p
        id={titleId}
        className="ui-text-body-lg font-semibold text-content-primary"
      >
        {title}
      </p>
      <div className="relative mt-4">
        <input
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            setError(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              submit();
            }
          }}
          onFocus={(event) => event.target.select()}
          aria-label={title}
          aria-invalid={error !== null}
          spellCheck={false}
          className={`h-10 w-full rounded-lg border border-border-primary bg-[var(--color-bg-surface)] px-3 ui-text-body text-content-primary outline-hidden focus:border-border-hover ${shownSuffix ? "pr-12" : ""}`}
          autoFocus
        />
        {shownSuffix && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 right-3 flex items-center ui-text-body text-content-muted"
          >
            {shownSuffix}
          </span>
        )}
      </div>
      <div className="mt-4 flex items-center gap-2">
        <p
          role="alert"
          className="min-w-0 flex-1 ui-text-meta text-pretty text-error"
        >
          {error}
        </p>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg px-3 py-2 ui-text-body-sm font-medium text-content-muted transition-colors hover:text-content-primary"
        >
          {cancelLabel}
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

export default NameDialog;
