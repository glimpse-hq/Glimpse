import { useState } from "react";
import { useLingui } from "@lingui/react/macro";
import {
  CLOUD_PROVIDERS,
  getProviderPreset,
  LOCAL_PROVIDERS,
} from "../../../shared/lib/llmProviders";
import type { LlmProvider } from "../../../types";
import { Dropdown } from "../../../shared/ui/Dropdown";
import ApiKeyField from "../../../shared/ui/ApiKeyField";
import ModelRow, {
  FIELD_BUTTON_CLASS,
  ModelRowField,
  shortEndpoint,
  type ModelRowState,
} from "./ModelRow";
import { useLanguageModelStatus } from "../useLanguageModelStatus";

type LanguageModelListProps = {
  llmProvider: LlmProvider;
  setLlmProvider: (value: LlmProvider) => void;
  llmEndpoint: string;
  setLlmEndpoint: (value: string) => void;
  llmApiKey: string;
  setLlmApiKey: (value: string) => void;
  llmModel: string;
  setLlmModel: (value: string) => void;
  llmConfigReady: boolean;
  availableModels: string[];
  fetchAvailableModels: () => void;
  activeLicense: boolean;
};

const LanguageModelList = ({
  llmProvider,
  setLlmProvider,
  llmEndpoint,
  setLlmEndpoint,
  llmApiKey,
  setLlmApiKey,
  llmModel,
  setLlmModel,
  llmConfigReady,
  availableModels,
  fetchAvailableModels,
  activeLicense,
}: LanguageModelListProps) => {
  const { t } = useLingui();
  const [expanded, setExpanded] = useState(false);
  const preset = getProviderPreset(llmProvider);
  const usesService = Boolean(preset && !preset.onDevice);
  const isServer =
    usesService && LOCAL_PROVIDERS.some((p) => p.id === llmProvider);
  const { appleAvailability, g1Installed, showG1 } = useLanguageModelStatus(
    llmProvider,
    llmConfigReady,
    activeLicense,
  );
  const uniqueModels = Array.from(
    new Set(availableModels.map((model) => model.trim()).filter(Boolean)),
  );
  const active: ModelRowState = {
    kind: "active",
    label: t({ id: "settings.models.card.active", message: "Active" }),
  };
  const onDevice = t({
    id: "settings.language_model.provider.on_device",
    message: "On-device",
  });
  const chooseModel = t({
    id: "settings.general.cleanup.model_placeholder",
    message: "Choose a model",
  });

  const select = (value: LlmProvider) => {
    if (value === llmProvider) return;
    setLlmProvider(value);
    const next = getProviderPreset(value);
    if (next) {
      setLlmEndpoint(next.endpoint);
      setLlmModel(next.defaultModel);
    }
  };

  const g1Blocker = !activeLicense
    ? t({ id: "settings.models.status.locked", message: "Locked" })
    : g1Installed === false
      ? t({
          id: "settings.models.status.not_installed",
          message: "Not installed",
        })
      : null;
  const appleBlocker =
    appleAvailability === "not_enabled"
      ? t({ id: "settings.models.status.off", message: "Off" })
      : appleAvailability === "not_ready"
        ? t({
            id: "settings.models.status.downloading",
            message: "Downloading",
          })
        : appleAvailability === "unsupported"
          ? t({
              id: "settings.models.status.unsupported",
              message: "Not supported",
            })
          : null;
  const g1Selected = llmProvider === "bonsai";
  const appleSelected = llmProvider === "apple";
  const serviceFacts = preset
    ? [
        isServer
          ? t({ id: "settings.models.group.server", message: "Local server" })
          : t({ id: "settings.models.location.cloud", message: "Cloud" }),
        llmConfigReady
          ? llmModel || preset.defaultModel
          : t({
              id: "settings.models.status.not_set_up",
              message: "Not set up",
            }),
      ].join("  ·  ")
    : "";

  return (
    <div className="flex flex-col">
      {showG1 && (
        <ModelRow
          title="G1"
          facts={
            g1Selected && g1Blocker
              ? `${onDevice}  ·  ${g1Blocker}`
              : !activeLicense
                ? t({
                    id: "settings.language_model.g1.locked",
                    message: "Needs a purchased Glimpse Plus license",
                  })
                : onDevice
          }
          factsWarning={g1Selected && Boolean(g1Blocker)}
          state={
            g1Selected
              ? active
              : g1Blocker
                ? { kind: "status", text: g1Blocker }
                : g1Installed === null
                  ? { kind: "status", text: "" }
                  : { kind: "use", onUse: () => select("bonsai") }
          }
        />
      )}
      {appleAvailability !== null && (
        <ModelRow
          title="Apple Intelligence"
          facts={
            appleSelected && appleAvailability === "not_enabled"
              ? t({
                  id: "settings.language_model.apple.not_enabled",
                  message:
                    "Turn on Apple Intelligence in System Settings to use this.",
                })
              : appleSelected && appleBlocker
                ? `${onDevice}  ·  ${appleBlocker}`
                : onDevice
          }
          factsWarning={appleSelected && Boolean(appleBlocker)}
          state={
            appleSelected
              ? active
              : appleBlocker
                ? { kind: "status", text: appleBlocker }
                : { kind: "use", onUse: () => select("apple") }
          }
        />
      )}
      <ModelRow
        title={
          usesService && preset
            ? preset.label
            : t({
                id: "settings.models.provider.title",
                message: "Server or cloud",
              })
        }
        facts={
          usesService
            ? serviceFacts
            : t({
                id: "settings.models.provider.facts",
                message: "Your own endpoint or API key",
              })
        }
        factsWarning={usesService && !llmConfigReady}
        state={
          usesService
            ? active
            : {
                kind: "use",
                label: t({
                  id: "settings.models.provider.set_up",
                  message: "Set up",
                }),
                onUse: () => setExpanded(true),
              }
        }
        expanded={expanded}
        onToggleExpanded={() => setExpanded((value) => !value)}
      >
        <ModelRowField
          label={t({
            id: "settings.language_model.provider",
            message: "Provider",
          })}
        >
          <Dropdown<LlmProvider>
            value={usesService ? llmProvider : null}
            ariaLabel={t({
              id: "settings.language_model.provider",
              message: "Provider",
            })}
            onChange={select}
            editableInput={
              llmProvider === "custom"
                ? {
                    value: llmEndpoint,
                    onChange: setLlmEndpoint,
                    placeholder: t({
                      id: "settings.language_model.endpoint.placeholder.v2",
                      message: "https://api.example.com/v1",
                    }),
                    ariaLabel: t({
                      id: "settings.language_model.endpoint.aria",
                      message: "LLM Endpoint URL",
                    }),
                  }
                : undefined
            }
            options={[
              {
                value: "_local_header" as LlmProvider,
                label: t({
                  id: "settings.models.group.server",
                  message: "Local server",
                }),
                isHeader: true,
              },
              ...LOCAL_PROVIDERS.filter(
                (p) => !p.onDevice && p.id !== "custom",
              ).map((p) => ({
                value: p.id,
                label: p.label,
                description: shortEndpoint(p.endpoint),
              })),
              {
                value: "custom" as LlmProvider,
                label: t({
                  id: "settings.language_model.provider.custom",
                  message: "Custom",
                }),
                description: t({
                  id: "settings.language_model.provider.custom.description",
                  message: "Enter your own endpoint URL",
                }),
              },
              {
                value: "_cloud_header" as LlmProvider,
                label: t({
                  id: "settings.language_model.provider.cloud.v2",
                  message: "Cloud (API key)",
                }),
                isHeader: true,
              },
              ...CLOUD_PROVIDERS.map((p) => ({ value: p.id, label: p.label })),
            ]}
            placeholder={t({
              id: "settings.language_model.provider.select",
              message: "Select provider...",
            })}
            searchable
            searchPlaceholder={t({
              id: "settings.language_model.provider.search",
              message: "Search providers...",
            })}
            buttonClassName={FIELD_BUTTON_CLASS}
          />
        </ModelRowField>
        <ModelRowField
          label={t({
            id: "settings.language_model.api_key.v2",
            message: "API key",
          })}
        >
          <ApiKeyField
            value={llmApiKey}
            onChange={setLlmApiKey}
            placeholder={
              preset?.apiKeyRequired
                ? t({
                    id: "settings.language_model.api_key.required",
                    message: "Required",
                  })
                : t({
                    id: "settings.language_model.api_key.optional",
                    message: "Optional",
                  })
            }
            ariaLabel={t({
              id: "settings.language_model.api_key.aria.v2",
              message: "Writing model API key",
            })}
          />
        </ModelRowField>
        <ModelRowField
          label={t({ id: "settings.language_model.model", message: "Model" })}
        >
          <Dropdown
            value={usesService && llmModel ? llmModel : null}
            ariaLabel={t({
              id: "settings.language_model.model",
              message: "Model",
            })}
            onChange={(val) => setLlmModel(val)}
            onOpen={usesService ? fetchAvailableModels : undefined}
            disabled={!usesService}
            options={[
              ...uniqueModels.map((model) => ({ value: model, label: model })),
              ...(llmModel && !uniqueModels.includes(llmModel)
                ? [{ value: llmModel, label: llmModel }]
                : []),
            ]}
            placeholder={chooseModel}
            searchable
            searchPlaceholder={t({
              id: "settings.language_model.model.search",
              message: "Search available models...",
            })}
            buttonClassName={FIELD_BUTTON_CLASS}
          />
        </ModelRowField>
      </ModelRow>
    </div>
  );
};

export default LanguageModelList;
