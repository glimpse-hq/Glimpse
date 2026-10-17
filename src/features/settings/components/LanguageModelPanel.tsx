import { useLingui } from "@lingui/react/macro";
import {
  CLOUD_PROVIDERS,
  getProviderPreset,
  LOCAL_PROVIDERS,
} from "../../../shared/lib/llmProviders";
import type { LlmProvider } from "../../../types";
import { Dropdown } from "../../../shared/ui/Dropdown";
import ApiKeyField from "../../../shared/ui/ApiKeyField";

type LanguageModelPanelProps = {
  llmProvider: LlmProvider;
  setLlmProvider: (value: LlmProvider) => void;
  llmEndpoint: string;
  setLlmEndpoint: (value: string) => void;
  llmApiKey: string;
  setLlmApiKey: (value: string) => void;
  llmModel: string;
  setLlmModel: (value: string) => void;
  availableModels: string[];
  fetchAvailableModels: () => void;
};

const LanguageModelPanel = ({
  llmProvider,
  setLlmProvider,
  llmEndpoint,
  setLlmEndpoint,
  llmApiKey,
  setLlmApiKey,
  llmModel,
  setLlmModel,
  availableModels,
  fetchAvailableModels,
}: LanguageModelPanelProps) => {
  const { t } = useLingui();
  const providerPreset = getProviderPreset(llmProvider);
  // On-device models are chosen in General; here they read as no provider.
  const hasSelectedProvider = Boolean(
    providerPreset && !providerPreset.onDevice,
  );
  const uniqueModels = Array.from(
    new Set(availableModels.map((model) => model.trim()).filter(Boolean)),
  );

  return (
    <div className="grid row-span-4 [grid-template-rows:subgrid] gap-3 rounded-lg bg-surface-surface p-2.5">
      <div className="px-2 py-1.5">
        <h3 className="ui-text-label-strong ui-color-primary">
          {t({
            id: "settings.language_model.title.v2",
            message: "Writing model",
          })}
        </h3>
      </div>

      <div className="px-2">
        <label className="ui-text-label-strong ui-color-primary block">
          {t({
            id: "settings.language_model.provider",
            message: "Provider",
          })}
        </label>
        <Dropdown
          value={llmProvider}
          ariaLabel={t({
            id: "settings.language_model.provider",
            message: "Provider",
          })}
          onChange={(val) => {
            setLlmProvider(val);
            const preset = getProviderPreset(val);
            if (preset) {
              setLlmEndpoint(preset.endpoint);
              setLlmModel(preset.defaultModel);
            }
          }}
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
              value: "_local_header" as LlmProvider,
              label: t({
                id: "settings.language_model.provider.local",
                message: "Local",
              }),
              isHeader: true,
            },
            ...LOCAL_PROVIDERS.filter(
              (p) => !p.onDevice && p.id !== "custom",
            ).map((p) => ({
              value: p.id,
              label: p.label,
              description: p.endpoint,
            })),
            {
              value: "_cloud_header" as LlmProvider,
              label: t({
                id: "settings.language_model.provider.cloud.v2",
                message: "Cloud (API key)",
              }),
              isHeader: true,
            },
            ...CLOUD_PROVIDERS.map((p) => ({
              value: p.id,
              label: p.label,
              description: p.endpoint,
            })),
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
          className="mt-2"
          buttonClassName="!rounded-none !border-0 !border-b !border-border-secondary !bg-transparent !px-0.5 !py-1 ui-text-body-sm hover:!border-content-primary focus:!border-content-primary"
          menuClassName="min-w-[240px]"
        />
      </div>

      <div className="px-2">
        <span className="ui-text-label-strong ui-color-primary block">
          {t({
            id: "settings.language_model.api_key.v2",
            message: "API key",
          })}
        </span>
        <ApiKeyField
          value={llmApiKey}
          onChange={setLlmApiKey}
          placeholder={
            providerPreset?.apiKeyRequired
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
      </div>

      <div className="px-2 pb-1">
        <span className="ui-text-label-strong ui-color-primary block">
          {t({
            id: "settings.language_model.model",
            message: "Model",
          })}
        </span>
        <Dropdown
          value={llmModel}
          ariaLabel={t({
            id: "settings.language_model.model",
            message: "Model",
          })}
          onChange={(val) => setLlmModel(val)}
          onOpen={hasSelectedProvider ? fetchAvailableModels : undefined}
          options={[
            ...uniqueModels.map((model) => ({
              value: model,
              label: model,
            })),
            ...(llmModel && !uniqueModels.includes(llmModel)
              ? [{ value: llmModel, label: llmModel }]
              : []),
          ]}
          placeholder={t({
            id: "settings.language_model.model.placeholder",
            message: `Model (default: ${providerPreset?.defaultModel || "none"})`,
          })}
          searchable
          searchPlaceholder={t({
            id: "settings.language_model.model.search",
            message: "Search available models...",
          })}
          className="mt-2"
          buttonClassName="!rounded-none !border-0 !border-b !border-border-secondary !bg-transparent !px-0.5 !py-1 ui-text-body-sm hover:!border-content-primary focus:!border-content-primary"
          menuClassName="min-w-[260px]"
        />
      </div>
    </div>
  );
};

export default LanguageModelPanel;
