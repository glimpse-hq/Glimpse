import type { ReactNode } from "react";

export const FIELD_BUTTON_CLASS =
  "!rounded-none !border-0 !border-b !border-border-secondary !bg-transparent !px-0.5 !py-1 ui-text-body-sm hover:!border-content-primary focus:!border-content-primary";

type ModelSourcePanelProps = {
  label: string;
  select: ReactNode;
  showFields: boolean;
  fields: ReactNode;
  status: ReactNode;
  warning: boolean;
};

// Speech and language share this layout: a source picker, then either the
// provider's fields or a status line in the same cell, so the height holds.
const ModelSourcePanel = ({
  label,
  select,
  showFields,
  fields,
  status,
  warning,
}: ModelSourcePanelProps) => (
  <div className="space-y-3 rounded-lg bg-surface-surface p-2.5">
    <div className="px-2 pt-1.5">
      <span className="ui-text-label-strong ui-color-primary block">
        {label}
      </span>
      {select}
    </div>
    <div className="grid px-2 pb-1">
      <div
        className={`col-start-1 row-start-1 space-y-3 ${showFields ? "" : "invisible"}`}
        inert={!showFields}
      >
        {fields}
      </div>
      <p
        className={`col-start-1 row-start-1 ui-text-meta ${showFields ? "invisible" : ""} ${
          warning ? "ui-color-warning" : "ui-color-muted"
        }`}
        aria-live="polite"
      >
        {status}
      </p>
    </div>
  </div>
);

export default ModelSourcePanel;
