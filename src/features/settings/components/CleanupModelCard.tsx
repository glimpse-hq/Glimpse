import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useLingui } from "@lingui/react/macro";
import { getProviderPreset } from "../../../shared/lib/llmProviders";
import type { LlmProvider } from "../../../types";
import { Dropdown } from "../../../shared/ui/Dropdown";
import { detectAppPlatform } from "../../../platform/service";

type AppleLlmAvailability =
  "available" | "not_enabled" | "not_ready" | "unsupported";

type G1Status = {
  supported: boolean;
  installed: boolean;
};

type CleanupModel = "apple" | "bonsai" | "cloud";

type CleanupModelCardProps = {
  llmProvider: LlmProvider;
  setLlmProvider: (value: LlmProvider) => void;
  setLlmEndpoint: (value: string) => void;
  llmConfigReady: boolean;
  activeLicense: boolean;
  onOpenProvidersTab: () => void;
};

const CleanupModelCard = ({
  llmProvider,
  setLlmProvider,
  setLlmEndpoint,
  llmConfigReady,
  activeLicense,
  onOpenProvidersTab,
}: CleanupModelCardProps) => {
  const { t } = useLingui();
  const providerPreset = getProviderPreset(llmProvider);
  const selected: CleanupModel | null = !providerPreset
    ? null
    : providerPreset.onDevice
      ? (llmProvider as CleanupModel)
      : "cloud";
  const providerLabel = providerPreset?.label ?? "";
  const isMac = detectAppPlatform() === "macos";
  const [appleAvailability, setAppleAvailability] =
    useState<AppleLlmAvailability | null>(null);
  const [g1Status, setG1Status] = useState<G1Status | null>(null);

  useEffect(() => {
    if (!isMac) {
      return;
    }
    let cancelled = false;
    invoke<AppleLlmAvailability>("apple_llm_availability")
      .then((value) => {
        if (!cancelled) setAppleAvailability(value);
      })
      .catch(() => {
        if (!cancelled) setAppleAvailability("unsupported");
      });
    return () => {
      cancelled = true;
    };
  }, [isMac]);

  // Rescans on provider changes, so model files copied in meanwhile show up.
  useEffect(() => {
    if (!isMac) {
      return;
    }
    let cancelled = false;
    invoke<G1Status>("g1_status")
      .then((value) => {
        if (!cancelled) setG1Status(value);
      })
      .catch(() => {
        if (!cancelled) setG1Status({ supported: false, installed: false });
      });
    return () => {
      cancelled = true;
    };
  }, [isMac, llmProvider]);

  // Backend probe hides this on Windows, Intel Macs, and macOS < 26.
  const showApple =
    isMac && appleAvailability !== null && appleAvailability !== "unsupported";
  // Hidden on Windows and Intel Macs.
  const showG1 = isMac && Boolean(g1Status?.supported);
  const g1LockedText = t({
    id: "settings.language_model.g1.locked",
    message: "Needs a purchased Glimpse Plus license",
  });

  const selectModel = (value: CleanupModel) => {
    if (value === selected) return;
    setLlmProvider(value === "cloud" ? "custom" : value);
    setLlmEndpoint("");
  };

  const g1StatusText = !activeLicense
    ? g1LockedText
    : g1Status === null
      ? null
      : g1Status.installed
        ? t({
            id: "settings.language_model.g1.ready",
            message: "Installed on this Mac.",
          })
        : t({
            id: "settings.language_model.g1.not_installed",
            message: "Not installed.",
          });

  const appleStatusText =
    appleAvailability === null
      ? null
      : appleAvailability === "not_enabled"
        ? t({
            id: "settings.language_model.apple.not_enabled",
            message:
              "Turn on Apple Intelligence in System Settings to use this.",
          })
        : appleAvailability === "not_ready"
          ? t({
              id: "settings.language_model.apple.not_ready",
              message: "The Apple Intelligence model is still downloading.",
            })
          : appleAvailability === "unsupported"
            ? t({
                id: "settings.language_model.apple.unsupported",
                message: "Not supported on this Mac.",
              })
            : t({
                id: "settings.language_model.apple.ready",
                message: "Built into this Mac.",
              });

  const cloudStatusPrefix = !llmConfigReady
    ? t({
        id: "settings.general.cleanup.cloud_setup_prefix",
        message: "Set up a provider and API key in",
      })
    : llmProvider === "custom"
      ? t({
          id: "settings.general.cleanup.cloud_custom_prefix",
          message: "Uses your own endpoint. Change it in",
        })
      : t({
          id: "settings.general.cleanup.cloud_ready_prefix",
          message: `Uses ${providerLabel}. Change it in`,
        });

  return (
    <div className="rounded-lg bg-surface-surface p-2.5">
      <div className="space-y-1.5 px-2 py-1.5">
        <span className="ui-text-label-strong ui-color-primary block">
          {t({
            id: "settings.language_model.model",
            message: "Model",
          })}
        </span>
        <Dropdown<CleanupModel>
          value={selected}
          ariaLabel={t({
            id: "settings.general.cleanup.model_aria",
            message: "Cleanup model",
          })}
          onChange={selectModel}
          options={[
            ...(showApple
              ? [
                  {
                    value: "apple" as const,
                    label: "Apple Intelligence",
                    description: t({
                      id: "settings.language_model.provider.on_device",
                      message: "On-device",
                    }),
                  },
                ]
              : []),
            ...(showG1
              ? [
                  {
                    value: "bonsai" as const,
                    label: "G1",
                    locked: !activeLicense,
                    description: activeLicense
                      ? t({
                          id: "settings.language_model.provider.on_device",
                          message: "On-device",
                        })
                      : g1LockedText,
                  },
                ]
              : []),
            {
              value: "cloud" as const,
              label: t({
                id: "settings.general.cleanup.cloud",
                message: "Cloud",
              }),
              description: t({
                id: "settings.general.cleanup.cloud_description",
                message: "Set up in Providers",
              }),
            },
          ]}
          placeholder={t({
            id: "settings.general.cleanup.model_placeholder",
            message: "Choose a model",
          })}
          buttonClassName="!rounded-none !border-0 !border-b !border-border-secondary !bg-transparent !px-0.5 !py-1 ui-text-body-sm hover:!border-content-primary focus:!border-content-primary"
          menuClassName="min-w-[240px]"
        />
        <p className="min-h-[2lh] ui-text-meta ui-color-muted">
          {selected === "bonsai" && g1StatusText}
          {selected === "apple" && appleStatusText}
          {selected === "cloud" && (
            <>
              {cloudStatusPrefix}{" "}
              <button
                type="button"
                onClick={onOpenProvidersTab}
                className="ui-color-primary underline underline-offset-2 decoration-[var(--color-border-secondary)] hover:decoration-[var(--color-text-primary)] transition-colors"
              >
                {t({
                  id: "settings.general.cleanup.providers_link",
                  message: "Providers",
                })}
              </button>
            </>
          )}
        </p>
      </div>
    </div>
  );
};

export default CleanupModelCard;
