import { useLingui } from "@lingui/react/macro";
import { X } from "@phosphor-icons/react";

export function DismissButton({ onClick }: { onClick: () => void }) {
  const { t } = useLingui();
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={t({ id: "record.warning.dismiss", message: "Dismiss" })}
      className="-mr-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-content-muted transition-colors hover:bg-surface-interactive hover:text-content-primary"
    >
      <X size={10} weight="bold" aria-hidden="true" />
    </button>
  );
}
