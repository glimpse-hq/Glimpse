import type { ReactNode } from "react";
import { useLingui } from "@lingui/react/macro";
import { Check } from "@phosphor-icons/react";

// What the right side of a row shows: the selection, a way to select it, or
// why it can't be selected.
export type ModelRowState =
  | { kind: "active"; label: string }
  | { kind: "fallback"; label: string }
  | { kind: "use"; onUse: () => void; label?: string }
  | { kind: "status"; text: string };

export type ModelRowProps = {
  title: string;
  titleAdornment?: ReactNode;
  facts: ReactNode;
  factsWarning?: boolean;
  state: ModelRowState;
  trailing?: ReactNode;
};

// One row of the Models grid: title, then the state column, then the action
// column. Rows join the grid as subgrids, so actions line up across every row
// at the width of the longest label in any language, and the title truncates
// first when space runs out.
const ModelRow = ({
  title,
  titleAdornment,
  facts,
  factsWarning = false,
  state,
  trailing,
}: ModelRowProps) => {
  const { t } = useLingui();
  const select = state.kind === "use" ? state.onUse : undefined;
  const label = "whitespace-nowrap ui-text-meta font-medium";

  return (
    <div className="group col-span-3 grid grid-cols-subgrid items-center rounded-lg transition-colors hover:bg-surface-elevated/40">
      <button
        type="button"
        onClick={select}
        disabled={!select}
        className="min-w-0 py-2 pl-2.5 text-left disabled:cursor-default"
      >
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
      </button>

      <div className="flex justify-end">
        {state.kind === "active" ? (
          <span className={`flex items-center gap-1 ${label} ui-color-cloud`}>
            <Check size={12} aria-hidden="true" />
            {state.label}
          </span>
        ) : state.kind === "fallback" ? (
          <span className={`${label} text-content-muted`}>{state.label}</span>
        ) : state.kind === "use" ? (
          <button
            type="button"
            onClick={state.onUse}
            className={`${label} text-content-secondary transition-colors hover:text-content-primary`}
          >
            {state.label ??
              t({ id: "settings.models.installed.use", message: "Use" })}
          </button>
        ) : (
          <span className="whitespace-nowrap ui-text-meta text-content-muted">
            {state.text}
          </span>
        )}
      </div>

      <div className="flex min-w-6 pr-2.5">{trailing}</div>
    </div>
  );
};

export default ModelRow;
