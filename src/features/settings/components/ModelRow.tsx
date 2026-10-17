import type { ReactNode } from "react";
import { useLingui } from "@lingui/react/macro";
import { motion } from "framer-motion";
import { CaretRight, Check } from "@phosphor-icons/react";

// What the right side of a row shows: the selection, a way to select it, or
// why it can't be selected.
export type ModelRowState =
  | { kind: "active"; label: string }
  | { kind: "fallback"; label: string }
  | { kind: "use"; label?: string; onUse: () => void }
  | { kind: "status"; text: string };

type ModelRowProps = {
  title: string;
  titleAdornment?: ReactNode;
  facts: ReactNode;
  factsWarning?: boolean;
  state: ModelRowState;
  trailing?: ReactNode;
  expanded?: boolean;
  onToggleExpanded?: () => void;
  children?: ReactNode;
};

// The underline field style the other Settings cards use.
export const FIELD_BUTTON_CLASS =
  "!rounded-none !border-0 !border-b !border-border-secondary !bg-transparent !px-0.5 !py-1 ui-text-body-sm hover:!border-content-primary focus:!border-content-primary";

export const shortEndpoint = (endpoint: string) =>
  endpoint.replace(/^https?:\/\//, "").replace(/\/v1$/, "");

export const ModelRowField = ({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) => (
  <div className="min-w-0">
    <span className="ui-text-label-strong ui-color-primary block">{label}</span>
    <div className="mt-1.5">{children}</div>
  </div>
);

const ModelRow = ({
  title,
  titleAdornment,
  facts,
  factsWarning = false,
  state,
  trailing,
  expanded,
  onToggleExpanded,
  children,
}: ModelRowProps) => {
  const { t } = useLingui();
  const select = state.kind === "use" ? state.onUse : undefined;
  const titleAction = select ?? onToggleExpanded;

  return (
    <div className="rounded-lg transition-colors hover:bg-surface-elevated/40">
      <div className="group grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-2.5 py-2">
        <button
          type="button"
          onClick={titleAction}
          disabled={!titleAction}
          className="min-w-0 text-left disabled:cursor-default"
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
              {state.label ??
                t({ id: "settings.models.installed.use", message: "Use" })}
            </button>
          ) : (
            <span className="ui-text-meta text-content-muted">
              {state.text}
            </span>
          )}
          {onToggleExpanded ? (
            <button
              type="button"
              onClick={onToggleExpanded}
              aria-expanded={expanded}
              aria-label={title}
              className="ui-button-ghost h-6 w-6"
            >
              <motion.span
                initial={false}
                animate={{ rotate: expanded ? 90 : 0 }}
                transition={{ duration: 0.15 }}
                className="flex"
              >
                <CaretRight size={12} aria-hidden="true" />
              </motion.span>
            </button>
          ) : (
            (trailing ?? (
              <span className="h-6 w-6 shrink-0" aria-hidden="true" />
            ))
          )}
        </div>
      </div>

      {expanded && (
        <div className="grid grid-cols-3 gap-3 px-2.5 pb-3 pt-1">
          {children}
        </div>
      )}
    </div>
  );
};

export default ModelRow;
