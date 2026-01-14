import { AnimatePresence, motion, type Variants } from "framer-motion";
import { AlertCircle, Download, Info, Key, Server, Square, Trash2 } from "lucide-react";
import { Dropdown } from "../../Dropdown";
import DotMatrix from "../../DotMatrix";
import { CLOUD_PROVIDERS, getProviderPreset, LOCAL_PROVIDERS } from "../../../lib/llmProviders";
import type { DownloadEvent, LlmProvider, ModelInfo, ModelStatus } from "../../../types";

type ModelsTabProps = {
    variants: Variants;
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
    modelCatalog: ModelInfo[];
    modelStatus: Record<string, ModelStatus>;
    downloadState: Record<string, DownloadEvent>;
    localModel: string;
    setLocalModel: (value: string) => void;
    handleDownload: (modelKey: string) => void;
    handleDelete: (modelKey: string) => void;
    handleCancelDownload: (modelKey: string) => void;
    formatBytes: (bytes: number) => string;
};

const ModelsTab = ({
    variants,
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
    modelCatalog,
    modelStatus,
    downloadState,
    localModel,
    setLocalModel,
    handleDownload,
    handleDelete,
    handleCancelDownload,
    formatBytes,
}: ModelsTabProps) => (
    <motion.div
        key="models"
        variants={variants}
        initial="hidden"
        animate="visible"
        exit="exit"
        className="space-y-5"
    >
        <header>
            <h1 className="text-lg font-medium text-content-primary">Local Models</h1>
            <p className="mt-1 text-[12px] text-content-muted">Manage transcription engines and AI cleanup.</p>
        </header>
        <div className="rounded-xl border border-border-primary bg-surface-surface">
            <div className="p-4">
                <div className="flex items-center justify-between mb-3">
                    <div>
                        <h3 className="text-[13px] font-medium text-content-primary">AI Cleanup</h3>
                        <p className="text-[11px] text-content-disabled">Use an LLM to clean up transcriptions</p>
                    </div>
                    <motion.button
                        onClick={() => setLlmCleanupEnabled(!llmCleanupEnabled)}
                        className={`relative w-10 h-5 rounded-full transition-colors ${llmCleanupEnabled ? "bg-cloud" : "bg-border-secondary"}`}
                        whileTap={{ scale: 0.95 }}
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
                                            ...LOCAL_PROVIDERS.filter(p => p.id !== "custom").map(p => ({
                                                value: p.id,
                                                label: p.label
                                            })),
                                            { value: "_cloud_header" as LlmProvider, label: "Cloud (API Key)", isHeader: true },
                                            ...CLOUD_PROVIDERS.map(p => ({
                                                value: p.id,
                                                label: p.label
                                            }))
                                        ]}
                                        placeholder="Select provider..."
                                        searchable
                                        searchPlaceholder="Search providers..."
                                    />
                                </div>

                                {llmProvider && (
                                    <>
                                        <div className="space-y-1.5">
                                            <label className="text-[11px] font-medium text-content-muted ml-1 flex items-center gap-1.5">
                                                <Server size={10} />
                                                Endpoint {llmProvider !== "custom" && <span className="text-content-disabled">(auto-filled)</span>}
                                            </label>
                                            <input
                                                type="text"
                                                value={llmEndpoint}
                                                onChange={(e) => setLlmEndpoint(e.target.value)}
                                                placeholder={getProviderPreset(llmProvider)?.endpoint ?? "https://your-llm-endpoint.com"}
                                                className="w-full rounded-lg bg-surface-elevated border border-border-secondary py-2 px-3 text-[12px] text-content-primary placeholder-content-disabled focus:border-content-disabled focus:outline-none transition-colors"
                                            />
                                        </div>

                                        <div className="space-y-1.5">
                                            <label className="text-[11px] font-medium text-content-muted ml-1 flex items-center gap-1.5">
                                                <Key size={10} />
                                                API Key {!getProviderPreset(llmProvider)?.apiKeyRequired && <span className="text-content-disabled">(if required)</span>}
                                            </label>
                                            <input
                                                type="password"
                                                value={llmApiKey}
                                                onChange={(e) => setLlmApiKey(e.target.value)}
                                                placeholder={getProviderPreset(llmProvider)?.apiKeyRequired ? "Required" : "Optional"}
                                                className="w-full rounded-lg bg-surface-elevated border border-border-secondary py-2 px-3 text-[12px] text-content-primary placeholder-content-disabled focus:border-content-disabled focus:outline-none transition-colors"
                                            />
                                        </div>

                                        <div className="relative z-0">
                                            <Dropdown
                                                value={llmModel}
                                                onChange={(val) => setLlmModel(val)}
                                                onOpen={fetchAvailableModels}
                                                options={[
                                                    ...availableModels.map(m => ({ value: m, label: m })),
                                                    ...(llmModel && !availableModels.includes(llmModel) ? [{ value: llmModel, label: llmModel }] : [])
                                                ]}
                                                placeholder={`Model (default: ${getProviderPreset(llmProvider)?.defaultModel || "none"})`}
                                                searchable
                                                searchPlaceholder="Search available models..."
                                            />
                                        </div>
                                    </>
                                )}

                                <div className="flex items-start gap-2 rounded-lg border border-border-secondary bg-surface-elevated px-3 py-2">
                                    <Info size={12} className="text-content-muted shrink-0 mt-0.5" />
                                    <p className="text-[10px] text-content-muted">
                                        Removes filler words, fixes repetitions, and cleans up speech disfluencies while preserving your meaning.
                                    </p>
                                </div>
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>
        </div>
        <div>
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-content-disabled mb-3">Transcription Engines</h3>
            <div className="space-y-2">
                {modelCatalog.map((model, index) => {
                    const modelStat = modelStatus[model.key];
                    const progress = downloadState[model.key];
                    const installed = modelStat?.installed;
                    const isActive = localModel === model.key && installed;
                    const isDownloading = progress?.status === "downloading";
                    const isCancelled = progress?.status === "cancelled";
                    const showError = progress?.status === "error";
                    const percent = progress?.percent ?? (installed ? 100 : 0);

                    return (
                        <motion.div
                            key={model.key}
                            initial={{ opacity: 0, y: 6 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: index * 0.04 }}
                            className={`rounded-xl border p-4 transition-colors ${isActive
                                ? "border-cloud-30 bg-cloud/[0.04]"
                                : "border-border-primary bg-surface-surface hover:border-border-secondary"
                                }`}
                        >
                            <div className="flex items-start justify-between gap-3">
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                        <h3 className="text-[13px] font-medium text-content-primary">{model.label}</h3>
                                        {isActive && (
                                            <span className="px-1.5 py-0.5 rounded text-[8px] font-semibold uppercase tracking-wider bg-cloud/20 text-cloud">Active</span>
                                        )}
                                    </div>
                                    <div className="flex flex-wrap gap-1.5 mt-1 mb-1.5">
                                        {model.tags.map(tag => {
                                            const isRecommended = tag.toLowerCase() === "recommended";
                                            return (
                                                <span
                                                    key={tag}
                                                    className={
                                                        isRecommended
                                                            ? "px-1.5 py-0.5 rounded text-[8px] font-semibold uppercase tracking-wider border bg-local-10 text-local border-local-40"
                                                            : "px-1.5 py-0.5 rounded text-[9px] font-medium bg-surface-elevated text-content-muted border border-border-secondary"
                                                    }
                                                >
                                                    {tag}
                                                </span>
                                            );
                                        })}
                                    </div>
                                    <p className="text-[11px] text-content-muted line-clamp-1">{model.description}</p>
                                    <div className="mt-2 flex items-center gap-2">
                                        <span className="text-[10px] text-content-disabled">{model.variant}</span>
                                        <span className="text-[10px] text-content-disabled">•</span>
                                        <span className="text-[10px] text-content-disabled">{formatBytes(model.size_mb * 1024 * 1024)}</span>
                                    </div>
                                </div>
                                <div className="flex shrink-0 items-center gap-2">
                                    {installed && !isActive && (
                                        <motion.button
                                            onClick={() => setLocalModel(model.key)}
                                            className="rounded-lg bg-surface-elevated border border-border-secondary px-3 py-1.5 text-[10px] font-medium text-content-secondary hover:bg-surface-elevated-hover hover:text-content-primary transition-colors"
                                            whileTap={{ scale: 0.97 }}
                                        >
                                            Use
                                        </motion.button>
                                    )}
                                    {isDownloading ? (
                                        <motion.button
                                            onClick={() => handleCancelDownload(model.key)}
                                            className="flex h-8 w-8 items-center justify-center rounded-lg border border-error/30 text-error hover:bg-error/10 transition-colors"
                                            whileTap={{ scale: 0.95 }}
                                            title="Stop download"
                                        >
                                            <Square size={10} fill="currentColor" />
                                        </motion.button>
                                    ) : (
                                        <motion.button
                                            onClick={() => (installed ? handleDelete(model.key) : handleDownload(model.key))}
                                            disabled={isCancelled}
                                            className={`flex h-8 w-8 items-center justify-center rounded-lg border transition-colors ${installed
                                                ? "border-error/20 text-error hover:bg-error/10"
                                                : isCancelled
                                                    ? "border-border-secondary text-content-disabled cursor-default"
                                                    : "border-border-secondary text-content-muted hover:bg-surface-elevated hover:text-content-secondary"
                                                }`}
                                            whileTap={!isCancelled ? { scale: 0.95 } : {}}
                                        >
                                            {installed ? (
                                                <Trash2 size={12} />
                                            ) : (
                                                <Download size={12} className={isCancelled ? "" : ""} />
                                            )}
                                        </motion.button>
                                    )}
                                </div>
                            </div>
                            {(isDownloading || !installed) && (
                                <div className="mt-3">
                                    <ModelProgress percent={percent} status={progress?.status ?? "idle"} />
                                    <div className="h-4 flex items-center mt-1.5">
                                        {isDownloading && (
                                            <p className="text-[10px] leading-none text-content-muted tabular-nums truncate w-full">
                                                {progress?.percent?.toFixed(0)}% · {(progress as Extract<DownloadEvent, { status: "downloading" }>).file}
                                            </p>
                                        )}
                                        {showError && (
                                            <p className="text-[10px] leading-none text-error flex items-center gap-1 w-full truncate">
                                                <AlertCircle size={10} />
                                                {(progress as Extract<DownloadEvent, { status: "error" }>).message}
                                            </p>
                                        )}
                                        {isCancelled && (
                                            <p className="text-[10px] leading-none text-content-muted">
                                                Cancelled
                                            </p>
                                        )}
                                    </div>
                                </div>
                            )}
                        </motion.div>
                    );
                })}
            </div>
        </div>
    </motion.div>
);

type ModelProgressProps = {
    percent: number;
    status: string;
};

const ModelProgress = ({ percent, status }: ModelProgressProps) => {
    const cols = 50;
    const rows = 3;
    const totalDots = cols * rows;
    const activeCount = Math.round((percent / 100) * totalDots);

    const activeDots = Array.from({ length: Math.min(activeCount, totalDots) }, (_, i) => i);

    const color =
        status === "error"
            ? "var(--color-error)"
            : status === "complete"
                ? "var(--color-success)"
                : "var(--color-cloud)";

    return (
        <DotMatrix
            rows={rows}
            cols={cols}
            activeDots={activeDots}
            dotSize={3}
            gap={2}
            color={color}
            className="opacity-70"
        />
    );
};

export default ModelsTab;
