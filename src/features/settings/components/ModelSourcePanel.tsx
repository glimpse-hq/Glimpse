import type { ReactNode } from "react";
import { useLingui } from "@lingui/react/macro";
import { Check } from "@phosphor-icons/react";

export const FIELD_BUTTON_CLASS =
  "!h-7 !rounded-md !bg-transparent !px-2.5 !py-0 ui-text-body-sm";

// Opens leftward so it stays inside the window from either column.
export const MENU_CLASS = "!left-auto min-w-[260px]";

export const shortEndpoint = (endpoint: string) =>
  endpoint.replace(/^https?:\/\//, "").replace(/\/v1$/, "");

export type ModelLocation = "device" | "server" | "cloud";

type ModelSourcePanelProps = {
  label: string;
  select: ReactNode;
  location: ModelLocation | null;
  showFields: boolean;
  apiKeyField: ReactNode;
  modelField: ReactNode;
  status: { text: string; ready: boolean } | null;
  guidance: ReactNode;
  warning: boolean;
};

// Speech and language share this layout. Labels and controls sit in one grid
// so they line up, and the provider fields and the on-device status share a
// cell so the card keeps its height when the choice changes.
const ModelSourcePanel = ({
  label,
  select,
  location,
  showFields,
  apiKeyField,
  modelField,
  status,
  guidance,
  warning,
}: ModelSourcePanelProps) => {
  const { t } = useLingui();
  const locationText =
    location === "device"
      ? t({ id: "settings.models.group.this_mac", message: "On this Mac" })
      : location === "server"
        ? t({ id: "settings.models.group.server", message: "Local server" })
        : t({ id: "settings.models.location.cloud", message: "Cloud" });
  const rowLabel = "ui-text-label-strong ui-color-primary";

  return (
    <div className="rounded-lg bg-surface-surface p-2.5">
      <div className="grid grid-cols-[max-content_minmax(0,1fr)] items-center gap-x-4 gap-y-2 px-2 py-1.5">
        <span className={rowLabel}>{label}</span>
        {select}
        <span
          className={`col-start-2 flex h-4 items-center gap-1.5 ui-text-meta ui-color-muted ${
            location ? "" : "invisible"
          }`}
        >
          <span
            aria-hidden="true"
            className={`h-1.5 w-1.5 rounded-full ${
              location === "cloud"
                ? "bg-[var(--color-cloud)]"
                : "bg-[var(--color-local)]"
            }`}
          />
          {locationText}
        </span>

        <div className="col-span-2 grid grid-cols-subgrid border-t border-border-secondary pt-2.5">
          <div
            className={`col-span-2 row-start-1 grid grid-cols-subgrid gap-y-2 ${
              showFields ? "" : "invisible"
            }`}
            inert={!showFields}
          >
            <span className={rowLabel}>
              {t({
                id: "settings.language_model.api_key.v2",
                message: "API key",
              })}
            </span>
            {apiKeyField}
            <span className={rowLabel}>
              {t({
                id: "settings.language_model.model",
                message: "Model",
              })}
            </span>
            {modelField}
          </div>
          <div
            className={`col-span-2 row-start-1 grid grid-cols-subgrid content-start gap-y-1 ${
              showFields ? "invisible" : ""
            }`}
            aria-live="polite"
          >
            <span className={`${rowLabel} flex h-7 items-center`}>
              {t({ id: "settings.models.status", message: "Status" })}
            </span>
            <span
              className={`flex h-7 items-center gap-1 ui-text-body-sm ${
                status?.ready
                  ? "ui-color-success"
                  : warning
                    ? "ui-color-warning"
                    : "ui-color-muted"
              }`}
            >
              {status?.ready && <Check size={12} aria-hidden="true" />}
              {status?.text}
            </span>
            <p
              className={`col-span-2 ui-text-meta ${warning ? "ui-color-warning" : "ui-color-muted"}`}
            >
              {guidance}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ModelSourcePanel;
