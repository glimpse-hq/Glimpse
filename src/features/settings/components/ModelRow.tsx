import type { ReactNode } from "react";
import { useLingui } from "@lingui/react/macro";
import { Check } from "@phosphor-icons/react";

// What the right side of a row shows: the selection, a way to select it, or
// why it can't be selected.
export type ModelRowState =
  | { kind: "active"; label: string }
  | { kind: "fallback"; label: string }
  | { kind: "use"; onUse: () => void }
  | { kind: "status"; text: string };

export type ModelRowProps = {
  leading?: ReactNode;
  title: string;
  titleAdornment?: ReactNode;
  facts: ReactNode;
  factsWarning?: boolean;
  state: ModelRowState;
  trailing?: ReactNode;
  surfaceClassName?: string;
};

const ModelRow = ({
  leading,
  title,
  titleAdornment,
  facts,
  factsWarning = false,
  state,
  trailing,
  surfaceClassName = "rounded-lg transition-colors hover:bg-surface-elevated/40",
}: ModelRowProps) => {
  const { t } = useLingui();
  const select = state.kind === "use" ? state.onUse : undefined;

  return (
    <div className={surfaceClassName}>
      <div className="group grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-2.5 py-2">
        <button
          type="button"
          onClick={select}
          disabled={!select}
          className="flex min-w-0 items-center gap-3.5 text-left disabled:cursor-default"
        >
          {leading}
          <span className="min-w-0">
            <span className="flex min-w-0 items-center gap-1.5 ui-text-body-sm-strong text-content-primary">
              <span className="truncate">{title}</span>
              {titleAdornment}
            </span>
            <span
              className={`mt-0.5 block truncate ui-text-meta tabular-nums ${
                factsWarning ? "ui-color-warning" : "text-content-muted"
              }`}
            >
              {facts}
            </span>
          </span>
        </button>

        <div className="flex items-center justify-end gap-2">
          {state.kind === "active" ? (
            <span className="flex items-center gap-1 ui-text-meta font-medium ui-color-cloud">
              <Check size={12} aria-hidden="true" />
              {state.label}
            </span>
          ) : state.kind === "fallback" ? (
            <span className="ui-text-meta font-medium text-content-muted">
              {state.label}
            </span>
          ) : state.kind === "use" ? (
            <button
              type="button"
              onClick={state.onUse}
              className="ui-text-meta font-medium text-content-secondary transition-colors hover:text-content-primary"
            >
              {t({ id: "settings.models.installed.use", message: "Use" })}
            </button>
          ) : (
            <span className="ui-text-meta text-content-muted">
              {state.text}
            </span>
          )}
          {trailing ?? <span className="h-6 w-6 shrink-0" aria-hidden="true" />}
        </div>
      </div>
    </div>
  );
};

export default ModelRow;
