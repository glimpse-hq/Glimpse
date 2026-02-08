import { AnimatePresence, motion } from "framer-motion";
import { Key, Server } from "lucide-react";
import { CLOUD_PROVIDERS, getProviderPreset, LOCAL_PROVIDERS } from "../lib/llmProviders";
import type { LlmProvider } from "../types";
import { Dropdown } from "./Dropdown";

type CleanupPanelProps = {
    llmCleanupEnabled: boolean;
    setLlmCleanupEnabled: (value: boolean) => void;
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

const CleanupPanel = ({
    llmCleanupEnabled,
    setLlmCleanupEnabled,
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
}: CleanupPanelProps) => {
    const providerPreset = getProviderPreset(llmProvider);
    const hasSelectedProvider = Boolean(providerPreset);
    const uniqueModels = Array.from(
        new Set(availableModels.map((model) => model.trim()).filter(Boolean))
    );

    return (
        <div className="rounded-xl border border-border-primary bg-surface-surface">
            <div className="p-4">
                <div className="flex items-center justify-between mb-3">
                    <div>
                        <h3 className="text-[13px] font-medium text-content-primary">AI Cleanup</h3>
                        <p className="text-[11px] text-content-disabled">Removes filler words, fixes grammar, and cleans up speech.</p>
                    </div>
                    <motion.button
                        onClick={() => setLlmCleanupEnabled(!llmCleanupEnabled)}
                        className={`relative w-10 h-5 rounded-full transition-colors ${llmCleanupEnabled ? "bg-cloud" : "bg-border-secondary"}`}
                        whileTap={{ scale: 0.95 }}
                        role="switch"
                        aria-checked={llmCleanupEnabled}
                        aria-label="Toggle AI Cleanup"
                    >
                        <motion.div
                            className="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm"
                            animate={{ left: llmCleanupEnabled ? "calc(100% - 18px)" : "2px" }}
                            transition={{ type: "spring", stiffness: 500, damping: 30 }}
                        />
                    </motion.button>
                </div>

                <AnimatePresence initial={false}>
                    {llmCleanupEnabled && (
                        <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: "auto", opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ type: "spring", stiffness: 400, damping: 35 }}
                            style={{ overflow: "visible" }}
                        >
                            <div className="pt-3 border-t border-border-primary space-y-3">
                                <div className="space-y-1.5">
                                    <label className="text-[11px] font-medium text-content-muted ml-1">Provider</label>
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
                                            { value: "custom" as LlmProvider, label: "Custom" },
                                            { value: "_local_header" as LlmProvider, label: "Local", isHeader: true },
                                            ...LOCAL_PROVIDERS.filter((p) => p.id !== "custom").map((p) => ({
                                                value: p.id,
                                                label: p.label,
                                            })),
                                            { value: "_cloud_header" as LlmProvider, label: "Cloud (API Key)", isHeader: true },
                                            ...CLOUD_PROVIDERS.map((p) => ({
                                                value: p.id,
                                                label: p.label,
                                            })),
                                        ]}
                                        placeholder="Select provider..."
                                        searchable
                                        searchPlaceholder="Search providers..."
                                    />
                                </div>

                                {hasSelectedProvider && (
                                    <>
                                        <div className="space-y-1.5">
                                            <label className="text-[11px] font-medium text-content-muted ml-1">
                                                Endpoint {llmProvider !== "custom" && <span className="text-content-disabled">(auto-filled)</span>}
                                            </label>
                                            <div className="flex items-center gap-2 rounded-lg border border-border-primary bg-surface-surface px-3 py-1.5 min-h-[40px] focus-within:border-border-hover transition-colors">
                                                <Server size={12} className="text-content-muted shrink-0" aria-hidden="true" />
                                                <input
                                                    type="text"
                                                    value={llmEndpoint}
                                                    onChange={(e) => setLlmEndpoint(e.target.value)}
                                                    placeholder={providerPreset?.endpoint ?? "https://your-llm-endpoint.com"}
                                                    aria-label="LLM Endpoint URL"
                                                    className="w-full bg-transparent text-[12px] text-content-primary placeholder-content-disabled outline-none"
                                                />
                                            </div>
                                        </div>

                                        <div className="space-y-1.5">
                                            <label className="text-[11px] font-medium text-content-muted ml-1">
                                                API Key {!providerPreset?.apiKeyRequired && <span className="text-content-disabled">(if required)</span>}
                                            </label>
                                            <div className="flex items-center gap-2 rounded-lg border border-border-primary bg-surface-surface px-3 py-1.5 min-h-[40px] focus-within:border-border-hover transition-colors">
                                                <Key size={12} className="text-content-muted shrink-0" aria-hidden="true" />
                                                <input
                                                    type="password"
                                                    value={llmApiKey}
                                                    onChange={(e) => setLlmApiKey(e.target.value)}
                                                    placeholder={providerPreset?.apiKeyRequired ? "Required" : "Optional"}
                                                    aria-label="LLM API Key"
                                                    className="w-full bg-transparent text-[12px] text-content-primary placeholder-content-disabled outline-none"
                                                />
                                            </div>
                                        </div>

                                        <div className="relative z-0">
                                            <Dropdown
                                                value={llmModel}
                                                onChange={(val) => setLlmModel(val)}
                                                onOpen={hasSelectedProvider ? fetchAvailableModels : undefined}
                                                options={[
                                                    ...uniqueModels.map((m) => ({ value: m, label: m })),
                                                    ...(llmModel && !uniqueModels.includes(llmModel)
                                                        ? [{ value: llmModel, label: llmModel }]
                                                        : []),
                                                ]}
                                                placeholder={`Model (default: ${providerPreset?.defaultModel || "none"})`}
                                                searchable
                                                searchPlaceholder="Search available models..."
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

export default CleanupPanel;
