import { useState } from "react";
import { AnimatePresence, motion, type Variants } from "framer-motion";
import { AlertCircle, Check, ChevronRight, Download, Info, Key, Server, Square, Trash2 } from "lucide-react";
import { Dropdown } from "../../Dropdown";
import DotMatrix from "../../DotMatrix";
import { CLOUD_PROVIDERS, getProviderPreset, LOCAL_PROVIDERS } from "../../../lib/llmProviders";
import type { DownloadEvent, LlmProvider, ModelInfo, ModelStatus } from "../../../types";

type EngineGroup = {
    id: string;
    label: string;
    description: string;
    recommended?: boolean;
};

const ENGINE_GROUPS: EngineGroup[] = [
    {
        id: "whisper",
        label: "Whisper",
        description: "OpenAI's speech recognition with custom vocabulary support.",
        recommended: true,
    },
    {
        id: "parakeet",
        label: "Parakeet TDT v3",
        description: "NVIDIA's fast English speech recognition.",
    },
    {
        id: "moonshine",
        label: "Moonshine",
        description: "Extremely fast, lightweight, optimized for real-time use.",
    },
];

const getSizeColor = (sizeMb: number): string => {
    if (sizeMb < 500) return "text-green-400";
    if (sizeMb < 1500) return "text-amber-400";
    return "text-red-400";
};

const getEngineId = (engine: string): string => {
    const lower = engine.toLowerCase();
    if (lower.includes("whisper")) return "whisper";
    if (lower.includes("parakeet")) return "parakeet";
    if (lower.includes("moonshine")) return "moonshine";
    return engine;
};

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
}: ModelsTabProps) => {
    const [expandedEngine, setExpandedEngine] = useState<string | null>(null);

    const groupedModels = ENGINE_GROUPS.map(group => ({
        ...group,
        models: modelCatalog.filter(m => getEngineId(m.engine) === group.id),
    })).filter(group => group.models.length > 0);

    const toggleEngine = (engineId: string) => {
        setExpandedEngine(prev => prev === engineId ? null : engineId);
    };

    return (
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

            {/* AI Cleanup Section */}
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
                                                    aria-label="LLM Endpoint URL"
                                                    className="w-full rounded-lg bg-surface-elevated border border-border-secondary py-2 px-3 text-[12px] text-content-primary placeholder-content-disabled focus:border-content-disabled focus:outline-none transition-colors"
                                                />
                                            </div>

                                            <div className="space-y-1.5">
                                                <label className="text-[11px] font-medium text-content-muted ml-1 flex items-center gap-1.5">
                                                    <Key size={10} aria-hidden="true" />
                                                    API Key {!getProviderPreset(llmProvider)?.apiKeyRequired && <span className="text-content-disabled">(if required)</span>}
                                                </label>
                                                <input
                                                    type="password"
                                                    value={llmApiKey}
                                                    onChange={(e) => setLlmApiKey(e.target.value)}
                                                    placeholder={getProviderPreset(llmProvider)?.apiKeyRequired ? "Required" : "Optional"}
                                                    aria-label="LLM API Key"
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

                                    <div className="flex items-center gap-2 rounded-lg border border-border-secondary bg-surface-elevated px-3 py-2">
                                        <Info size={12} className="text-content-muted shrink-0" />
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

            {/* Transcription Engines */}
            <div>
                <h3 className="text-[11px] font-semibold uppercase tracking-wider text-content-disabled mb-3">Transcription Engines</h3>
                <div className="rounded-xl border border-border-primary bg-surface-surface overflow-hidden divide-y divide-border-primary">
                    {groupedModels.map((group) => {
                        const isExpanded = expandedEngine === group.id;
                        const installedCount = group.models.filter(m => modelStatus[m.key]?.installed).length;
                        const hasActiveModel = group.models.some(m => localModel === m.key && modelStatus[m.key]?.installed);
                        const activeModel = group.models.find(m => localModel === m.key && modelStatus[m.key]?.installed);

                        return (
                            <div key={group.id}>
                                <button
                                    onClick={() => toggleEngine(group.id)}
                                    className="w-full px-4 py-3 flex items-center gap-3 hover:bg-surface-elevated/50 transition-colors"
                                    aria-expanded={isExpanded}
                                >
                                    <motion.div
                                        animate={{ rotate: isExpanded ? 90 : 0 }}
                                        transition={{ duration: 0.15 }}
                                        className="text-content-disabled"
                                    >
                                        <ChevronRight size={14} aria-hidden="true" />
                                    </motion.div>
                                    <div className="flex-1 text-left">
                                        <div className="flex items-center gap-2">
                                            <span className="text-[13px] font-medium text-content-primary">{group.label}</span>
                                            {group.recommended && (
                                                <span className="text-[10px] text-local">Recommended</span>
                                            )}
                                            {hasActiveModel && activeModel && (
                                                <span className="text-[10px] text-cloud">{activeModel.label}</span>
                                            )}
                                        </div>
                                        <p className="text-[11px] text-content-disabled">{group.description}</p>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        {hasActiveModel && (
                                            <div className="flex items-center justify-center w-5 h-5 rounded-full bg-cloud/20">
                                                <Check size={12} className="text-cloud" />
                                            </div>
                                        )}
                                        {!hasActiveModel && installedCount > 0 && (
                                            <span className="text-[10px] text-content-disabled">
                                                {installedCount} installed
                                            </span>
                                        )}
                                    </div>
                                </button>

                                <AnimatePresence initial={false}>
                                    {isExpanded && (
                                        <motion.div
                                            initial={{ height: 0 }}
                                            animate={{ height: "auto" }}
                                            exit={{ height: 0 }}
                                            transition={{ duration: 0.2 }}
                                            className="overflow-hidden bg-surface-elevated/30"
                                        >
                                            <div className="px-4 py-2 space-y-1">
                                                {group.models.map((model) => (
                                                    <ModelRow
                                                        key={model.key}
                                                        model={model}
                                                        modelStatus={modelStatus[model.key]}
                                                        downloadState={downloadState[model.key]}
                                                        isActive={localModel === model.key && modelStatus[model.key]?.installed}
                                                        onUse={() => setLocalModel(model.key)}
                                                        onDownload={() => handleDownload(model.key)}
                                                        onDelete={() => handleDelete(model.key)}
                                                        onCancel={() => handleCancelDownload(model.key)}
                                                        formatBytes={formatBytes}
                                                    />
                                                ))}
                                            </div>
                                        </motion.div>
                                    )}
                                </AnimatePresence>
                            </div>
                        );
                    })}
                </div>
            </div>
        </motion.div>
    );
};

type ModelRowProps = {
    model: ModelInfo;
    modelStatus?: ModelStatus;
    downloadState?: DownloadEvent;
    isActive: boolean;
    onUse: () => void;
    onDownload: () => void;
    onDelete: () => void;
    onCancel: () => void;
    formatBytes: (bytes: number) => string;
};

const ModelRow = ({
    model,
    modelStatus: status,
    downloadState: progress,
    isActive,
    onUse,
    onDownload,
    onDelete,
    onCancel,
    formatBytes,
}: ModelRowProps) => {
    const installed = status?.installed;
    const isDownloading = progress?.status === "downloading";
    const isCancelled = progress?.status === "cancelled";
    const showError = progress?.status === "error";
    const percent = progress?.percent ?? (installed ? 100 : 0);
    const isRecommended = model.tags.some(t => t.toLowerCase() === "recommended");

    return (
        <div className={`rounded-lg px-3 py-2.5 transition-colors ${isActive ? "bg-cloud/10" : "hover:bg-surface-elevated/50"}`}>
            <div className="flex items-center gap-3">
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                        <span className={`text-[12px] font-medium ${isActive ? "text-cloud" : "text-content-primary"}`}>
                            {model.label}
                        </span>
                        {isRecommended && (
                            <span className="text-[10px] text-local">Recommended</span>
                        )}
                        {isActive && (
                            <span className="px-1.5 py-0.5 rounded text-[8px] font-semibold uppercase tracking-wider bg-cloud/20 text-cloud">
                                Active
                            </span>
                        )}
                    </div>
                    <div className="flex items-center gap-1.5 mt-0.5">
                        <span className={`text-[10px] ${getSizeColor(model.size_mb)}`}>{formatBytes(model.size_mb * 1024 * 1024)}</span>
                        {model.tags.filter(t => t.toLowerCase() !== "recommended").length > 0 && (
                            <>
                                <span className="text-[10px] text-content-disabled">·</span>
                                <span className="text-[10px] text-content-disabled">
                                    {model.tags.filter(t => t.toLowerCase() !== "recommended").join(", ")}
                                </span>
                            </>
                        )}
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    {installed && !isActive && (
                        <button
                            onClick={onUse}
                            className="px-2.5 py-1 rounded-md text-[10px] font-medium text-content-secondary hover:text-content-primary hover:bg-surface-elevated transition-colors"
                        >
                            Use
                        </button>
                    )}
                    {isDownloading ? (
                        <button
                            onClick={onCancel}
                            className="flex h-6 w-6 items-center justify-center rounded-md text-error hover:bg-error/10 transition-colors"
                            title="Cancel"
                            aria-label="Cancel download"
                        >
                            <Square size={10} fill="currentColor" aria-hidden="true" />
                        </button>
                    ) : installed ? (
                        <button
                            onClick={onDelete}
                            className="flex h-6 w-6 items-center justify-center rounded-md text-content-disabled hover:text-error hover:bg-error/10 transition-colors"
                            title="Delete"
                            aria-label="Delete model"
                        >
                            <Trash2 size={12} aria-hidden="true" />
                        </button>
                    ) : (
                        <button
                            onClick={onDownload}
                            disabled={isCancelled}
                            className={`flex h-6 w-6 items-center justify-center rounded-md transition-colors ${
                                isCancelled
                                    ? "text-content-disabled cursor-default"
                                    : "text-content-muted hover:text-content-primary hover:bg-surface-elevated"
                            }`}
                            title="Download"
                            aria-label="Download model"
                        >
                            <Download size={12} aria-hidden="true" />
                        </button>
                    )}
                </div>
            </div>

            {(isDownloading || showError || isCancelled) && (
                <div className="mt-2">
                    <ModelProgress percent={percent} status={progress?.status ?? "idle"} />
                    <div className="h-3 flex items-center mt-1">
                        {isDownloading && (
                            <p className="text-[9px] text-content-disabled tabular-nums truncate">
                                {progress?.percent?.toFixed(0)}% · {(progress as Extract<DownloadEvent, { status: "downloading" }>).file}
                            </p>
                        )}
                        {showError && (
                            <p className="text-[9px] text-error flex items-center gap-1">
                                <AlertCircle size={9} />
                                {(progress as Extract<DownloadEvent, { status: "error" }>).message}
                            </p>
                        )}
                        {isCancelled && (
                            <p className="text-[9px] text-content-disabled">Cancelled</p>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

type ModelProgressProps = {
    percent: number;
    status: string;
};

const ModelProgress = ({ percent, status }: ModelProgressProps) => {
    const cols = 40;
    const rows = 2;
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
            dotSize={2}
            gap={2}
            color={color}
            className="opacity-60"
        />
    );
};

export default ModelsTab;
