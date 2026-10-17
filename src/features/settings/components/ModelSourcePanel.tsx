import type { ReactNode } from "react";
import { useLingui } from "@lingui/react/macro";
import { Check } from "@phosphor-icons/react";
import SettingCard from "../../../shared/ui/SettingCard";

// The underline field style the other Settings cards use.
export const FIELD_BUTTON_CLASS =
  "!rounded-none !border-0 !border-b !border-border-secondary !bg-transparent !px-0.5 !py-1 ui-text-body-sm hover:!border-content-primary focus:!border-content-primary";

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

// Speech and language share this layout. The provider fields and the
// on-device status share one cell so the card keeps its height.
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
      ? t({
          id: "settings.models.group.this_computer",
          message: "On this computer",
        })
      : location === "server"
        ? t({ id: "settings.models.group.server", message: "Local server" })
        : t({ id: "settings.models.location.cloud", message: "Cloud" });
  const labelClass = "ui-text-label-strong ui-color-primary block";

  return (
    <SettingCard>
      <div className="px-2 py-1.5">
        <span className={labelClass}>{label}</span>
        <div className="mt-1.5">{select}</div>
        <span
          className={`mt-1.5 flex items-center gap-1.5 ui-text-meta ui-color-muted ${
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
      </div>

      <div className="grid">
        <div
          className={`col-start-1 row-start-1 ${showFields ? "" : "invisible"}`}
          inert={!showFields}
        >
          <div className="px-2 py-1.5">
            <span className={labelClass}>
              {t({
                id: "settings.language_model.api_key.v2",
                message: "API key",
              })}
            </span>
            <div className="mt-1.5">{apiKeyField}</div>
          </div>
          <div className="px-2 py-1.5">
            <span className={labelClass}>
              {t({
                id: "settings.language_model.model",
                message: "Model",
              })}
            </span>
            <div className="mt-1.5">{modelField}</div>
          </div>
        </div>
        <div
          className={`col-start-1 row-start-1 px-2 py-1.5 ${showFields ? "invisible" : ""}`}
          aria-live="polite"
        >
          <span className={labelClass}>
            {t({ id: "settings.models.status", message: "Status" })}
          </span>
          <span
            className={`mt-1.5 flex items-center gap-1 px-0.5 py-1 ui-text-body-sm ${
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
            className={`mt-1 ui-text-meta ${warning ? "ui-color-warning" : "ui-color-muted"}`}
          >
            {guidance}
          </p>
        </div>
      </div>
    </SettingCard>
  );
};

export default ModelSourcePanel;
