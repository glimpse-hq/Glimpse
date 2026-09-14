import type { ReactNode } from "react";
import { Broom, Cloud, Ghost } from "@phosphor-icons/react";
import ToggleSwitch from "../../../shared/ui/ToggleSwitch";
import { detectAppPlatform } from "../../../platform/service";

type ProviderGuideProps = {
  body: string;
  actionLabel: string;
  onAction: () => void;
  illustration: ReactNode;
};

const ProviderGuide = ({
  body,
  actionLabel,
  onAction,
  illustration,
}: ProviderGuideProps) => (
  <div className="flex items-center gap-4 rounded-lg bg-surface-surface px-3 py-2.5">
    <div className="flex shrink-0 flex-col items-center gap-1.5">
      <div aria-hidden="true">{illustration}</div>
      <button
        type="button"
        onClick={onAction}
        className="ui-text-micro ui-color-primary underline underline-offset-2 decoration-[var(--color-border-secondary)] transition-colors hover:decoration-[var(--color-text-primary)]"
      >
        {actionLabel}
      </button>
    </div>
    <p className="min-w-0 flex-1 ui-text-meta ui-color-muted">{body}</p>
  </div>
);

export const CloudCardIllustration = ({
  providerLabel,
}: {
  providerLabel: string;
}) => (
  <div className="flex items-center gap-2 rounded-md border border-border-secondary bg-surface-overlay px-2 py-1">
    <span className="flex max-w-20 items-center gap-1 ui-text-micro font-semibold ui-color-primary">
      <Cloud size={11} weight="fill" className="shrink-0 ui-color-cloud" />
      <span className="truncate">{providerLabel}</span>
    </span>
    <span inert className="shrink-0">
      <ToggleSwitch size="xs" enabled onToggle={() => {}} ariaLabel="" />
    </span>
  </div>
);

export const CleanupShortcutIllustration = () => (
  <div className="flex items-center gap-1.5 border-b border-border-secondary py-0.5 ui-text-kbd ui-color-secondary">
    <span className="whitespace-nowrap">
      {detectAppPlatform() === "macos" ? "⌥ Space" : "Alt Space"}
    </span>
    <span className="flex h-5 w-5 items-center justify-center rounded-md border border-transparent ui-color-muted">
      <Ghost size={13} />
    </span>
    <span className="flex h-5 w-5 items-center justify-center rounded-md border border-[var(--color-cloud-30)] bg-[var(--color-cloud-10)] text-[var(--color-cloud)]">
      <Broom size={13} />
    </span>
  </div>
);

export default ProviderGuide;
