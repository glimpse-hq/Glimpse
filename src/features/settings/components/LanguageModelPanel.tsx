import { useLingui } from "@lingui/react/macro";
import { AnimatePresence, motion } from "framer-motion";
import { Key, Server } from "lucide-react";
import ToggleSwitch from "../../../shared/ui/ToggleSwitch";
import {
  CLOUD_PROVIDERS,
  getProviderPreset,
  LOCAL_PROVIDERS,
} from "../../../shared/lib/llmProviders";
import type { LlmProvider } from "../../../types";
import { Dropdown } from "../../../shared/ui/Dropdown";

type LanguageModelPanelProps = {
  llmEnabled: boolean;
  setLlmEnabled: (value: boolean) => void;
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
  llmEnabled,
  setLlmEnabled,
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
  const hasSelectedProvider = Boolean(providerPreset);
  const uniqueModels = Array.from(
    new Set(availableModels.map((model) => model.trim()).filter(Boolean)),
  );

  return (
    <div className="rounded-xl border border-border-primary bg-surface-surface shadow-[0_3px_0_-1px_rgba(0,0,0,0.5),inset_0_1px_0_0_rgba(255,255,255,0.06)]">
      <div className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="ui-text-body-strong ui-color-primary">
              {t({
                id: "settings.language_model.title",
                message: "Language Model Provider",
              })}
            </h3>
            <p className="ui-text-label ui-color-disabled">
              {t({
                id: "settings.language_model.description",
                message: "Shared by Cleanup, Edit Mode, and Personalization.",
              })}
            </p>
          </div>
          <ToggleSwitch
            enabled={llmEnabled}
            onToggle={() => setLlmEnabled(!llmEnabled)}
            ariaLabel={t({
              id: "settings.language_model.toggle",
              message: "Toggle AI features",
            })}
            size="md"
          />
        </div>

        <AnimatePresence initial={false}>
          {llmEnabled && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ type: "spring", stiffness: 400, damping: 35 }}
              style={{ overflow: "visible" }}
            >
              <div className="pt-3 border-t border-border-primary space-y-3">
                <div className="space-y-1.5">
                  <label className="ui-text-label-strong ui-color-muted ml-1">
                    {t({
                      id: "settings.language_model.provider",
                      message: "Provider",
                    })}
                  </label>
                  <Dropdown
                    value={llmProvider}
                    onChange={(val) => {
                      setLlmProvider(val);
                      const preset = getProviderPreset(val);
                      if (preset) {
                        setLlmEndpoint(preset.endpoint);
                        setLlmModel(preset.defaultModel);
                      }
                    }}
                    options={[
                      {
                        value: "custom" as LlmProvider,
                        label: t({
                          id: "settings.language_model.provider.custom",
                          message: "Custom",
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
                      ...LOCAL_PROVIDERS.filter((p) => p.id !== "custom").map(
                        (p) => ({
                          value: p.id,
                          label: p.label,
                        }),
                      ),
                      {
                        value: "_cloud_header" as LlmProvider,
                        label: t({
                          id: "settings.language_model.provider.cloud",
                          message: "Cloud (API Key)",
                        }),
                        isHeader: true,
                      },
                      ...CLOUD_PROVIDERS.map((p) => ({
                        value: p.id,
                        label: p.label,
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
                  />
                </div>

                {hasSelectedProvider && (
                  <>
                    <div className="space-y-1.5">
                      <label className="ui-text-label-strong ui-color-muted ml-1">
                        {t({
                          id: "settings.language_model.endpoint",
                          message: "Endpoint",
                        })}{" "}
                        {llmProvider !== "custom" && (
                          <span className="text-content-disabled">
                            {t({
                              id: "settings.language_model.endpoint.autofilled",
                              message: "(auto-filled)",
                            })}
                          </span>
                        )}
                      </label>
                      <div className="flex items-center gap-2 rounded-lg border border-border-primary bg-surface-surface px-3 py-1.5 min-h-[40px] focus-within:border-border-hover transition-colors">
                        <Server
                          size={12}
                          className="text-content-muted shrink-0"
                          aria-hidden="true"
                        />
                        <input
                          type="text"
                          value={llmEndpoint}
                          onChange={(e) => setLlmEndpoint(e.target.value)}
                          placeholder={
                            providerPreset?.endpoint ??
                            t({
                              id: "settings.language_model.endpoint.placeholder",
                              message: "https://your-llm-endpoint.com",
                            })
                          }
                          aria-label={t({
                            id: "settings.language_model.endpoint.aria",
                            message: "LLM Endpoint URL",
                          })}
                          className="w-full bg-transparent ui-text-input ui-color-primary placeholder-content-disabled outline-hidden"
                        />
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <label className="ui-text-label-strong ui-color-muted ml-1">
                        {t({
                          id: "settings.language_model.api_key",
                          message: "API Key",
                        })}{" "}
                        {!providerPreset?.apiKeyRequired && (
                          <span className="text-content-disabled">
                            {t({
                              id: "settings.language_model.api_key.optional_hint",
                              message: "(if required)",
                            })}
                          </span>
                        )}
                      </label>
                      <div className="flex items-center gap-2 rounded-lg border border-border-primary bg-surface-surface px-3 py-1.5 min-h-[40px] focus-within:border-border-hover transition-colors">
                        <Key
                          size={12}
                          className="text-content-muted shrink-0"
                          aria-hidden="true"
                        />
                        <input
                          type="password"
                          value={llmApiKey}
                          onChange={(e) => setLlmApiKey(e.target.value)}
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
                          aria-label={t({
                            id: "settings.language_model.api_key.aria",
                            message: "LLM API Key",
                          })}
                          className="w-full bg-transparent ui-text-input ui-color-primary placeholder-content-disabled outline-hidden"
                        />
                      </div>
                    </div>

                    <div className="relative z-0">
                      <Dropdown
                        value={llmModel}
                        onChange={(val) => setLlmModel(val)}
                        onOpen={
                          hasSelectedProvider ? fetchAvailableModels : undefined
                        }
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
                      />
                    </div>
                  </>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};

export default LanguageModelPanel;
