import { useLingui } from "@lingui/react/macro";
import { useEffect, useState, type MouseEvent } from "react";
import { motion } from "framer-motion";
import { X } from "lucide-react";
import { Dropdown, type DropdownOption } from "../../../shared/ui/Dropdown";
import ToggleSwitch from "../../../shared/ui/ToggleSwitch";
import { hasModelCapability, MODEL_CAPABILITY_TIMESTAMPS } from "../../../shared/lib/modelCapabilities";
import type { LibraryImportOptions, ModelInfo } from "../../../types";

const isTimestampSupported = (model?: ModelInfo | null) =>
    hasModelCapability(model, MODEL_CAPABILITY_TIMESTAMPS);

type LibraryImportModalProps = {
    paths: string[];
    models: ModelInfo[];
    defaultModelKey?: string;
    onCancel: () => void;
    onConfirm: (paths: string[], options: LibraryImportOptions) => Promise<void> | void;
};

const LibraryImportModal = ({
    paths,
    models,
    defaultModelKey,
    onCancel,
    onConfirm,
}: LibraryImportModalProps) => {
    const { t } = useLingui();
    const [storeOriginal, setStoreOriginal] = useState(true);
    const [selectedModelKey, setSelectedModelKey] = useState<string>(defaultModelKey || "");
    const [showTimestamps, setShowTimestamps] = useState(true);
    const [isImporting, setIsImporting] = useState(false);

    const modelOptions: DropdownOption<string>[] = models.map((model) => ({
        value: model.key,
        label: model.label,
        description: model.description,
    }));

    useEffect(() => {
        if (!selectedModelKey && modelOptions.length > 0) {
            setSelectedModelKey(modelOptions[0].value);
        }
    }, [modelOptions, selectedModelKey]);

    const selectedModel = models.find((model) => model.key === selectedModelKey) ?? null;
    const timestampsSupported = isTimestampSupported(selectedModel);

    useEffect(() => {
        if (!timestampsSupported) {
            setShowTimestamps(false);
        }
    }, [timestampsSupported]);

    const importPaths = paths.length > 0 ? paths : [];
    const summary = importPaths.length === 1
        ? t({
            id: "library.import.summary.single",
            message: "1 file",
        })
        : t({
            id: "library.import.summary.multiple",
            message: `${importPaths.length} files`,
        });

    const handleConfirm = async () => {
        if (!selectedModelKey) return;
        setIsImporting(true);
        const options: LibraryImportOptions = {
            store_original: storeOriginal,
            model_key: selectedModelKey,
            llm_cleanup_enabled: false,
            show_timestamps: showTimestamps,
        };
        await onConfirm(importPaths, options);
        setIsImporting(false);
    };

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-[95] flex items-center justify-center bg-black/70 backdrop-blur-xs"
            onClick={onCancel}
            role="dialog"
            aria-modal="true"
        >
            <motion.div
                initial={{ opacity: 0, scale: 0.96, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.96, y: 20 }}
                transition={{ duration: 0.2, ease: "easeOut" }}
                className="relative w-[520px] max-w-[92vw] bg-surface-overlay border border-border-secondary rounded-2xl shadow-2xl overflow-hidden"
                onClick={(e: MouseEvent<HTMLDivElement>) => e.stopPropagation()}
            >
                <div className="flex items-center justify-between px-5 py-3 border-b border-border-primary">
                    <div>
                        <p className="ui-text-meta uppercase tracking-[0.2em] text-content-disabled">
                            {t({
                                id: "library.import.title",
                                message: "Import to Library",
                            })}
                        </p>
                        <p className="ui-text-body-lg text-content-primary mt-1">{summary}</p>
                    </div>
                    <button
                        onClick={onCancel}
                        className="rounded-lg border border-border-primary bg-surface-surface p-2 text-content-muted hover:text-content-secondary"
                    >
                        <X size={14} />
                    </button>
                </div>

                <div className="px-5 py-4 space-y-4">
                    {models.length === 0 && (
                        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 ui-text-label text-amber-200">
                            {t({
                                id: "library.import.no_models",
                                message: "No local models are installed. Download a model in Settings -> Models before importing.",
                            })}
                        </div>
                    )}
                    <div className="rounded-lg border border-border-primary bg-surface-surface p-3">
                        <div className="ui-text-label text-content-muted mb-2">
                            {t({
                                id: "library.import.files",
                                message: "Files",
                            })}
                        </div>
                        <div className="max-h-28 overflow-auto custom-scrollbar ui-text-body-sm text-content-secondary space-y-1">
                            {importPaths.map((path, idx) => (
                                <div key={`${path}-${idx}`} className="truncate">{path}</div>
                            ))}
                        </div>
                    </div>

                    <div>
                        <label className="ui-text-label font-medium text-content-muted ml-1">
                            {t({
                                id: "library.import.model",
                                message: "Model",
                            })}
                        </label>
                        <Dropdown
                            value={selectedModelKey || null}
                            onChange={(value) => setSelectedModelKey(value)}
                            options={modelOptions}
                            placeholder={t({
                                id: "library.import.select_model",
                                message: "Select a model",
                            })}
                            searchable
                            searchPlaceholder={t({
                                id: "library.import.search_models",
                                message: "Search installed models...",
                            })}
                        />
                        <div className="mt-2 flex items-start gap-2 ui-text-meta text-content-disabled ml-1">
                        </div>
                    </div>

                    <div className="flex items-center justify-between rounded-lg border border-border-primary bg-surface-surface px-4 py-3">
                        <div>
                            <div className="ui-text-body-sm text-content-primary font-medium">
                                {t({
                                    id: "library.import.store_original",
                                    message: "Store original file",
                                })}
                            </div>
                            <div className="ui-text-meta text-content-disabled">
                                {t({
                                    id: "library.import.store_original.description",
                                    message: "Keep a copy inside the library folder",
                                })}
                            </div>
                        </div>
                        <ToggleSwitch
                            enabled={storeOriginal}
                            onToggle={() => setStoreOriginal(!storeOriginal)}
                            ariaLabel={t({
                                id: "library.import.store_original.aria",
                                message: "Store original",
                            })}
                            size="md"
                        />
                    </div>

                    <div className="flex items-center justify-between rounded-lg border border-border-primary bg-surface-surface px-4 py-3">
                        <div>
                            <div className="ui-text-body-sm text-content-primary font-medium">
                                {t({
                                    id: "library.import.show_timestamps",
                                    message: "Show timestamps",
                                })}
                            </div>
                            <div className="ui-text-meta text-content-disabled">
                                {timestampsSupported
                                    ? t({
                                        id: "library.import.timestamps_supported",
                                        message: "Enabled for supported models",
                                    })
                                    : t({
                                        id: "library.import.timestamps_unsupported",
                                        message: "Not supported by this model",
                                    })}
                            </div>
                        </div>
                        <ToggleSwitch
                            enabled={showTimestamps}
                            onToggle={() => timestampsSupported && setShowTimestamps(!showTimestamps)}
                            ariaLabel={t({
                                id: "library.import.show_timestamps.aria",
                                message: "Show timestamps",
                            })}
                            disabled={!timestampsSupported}
                            size="md"
                        />
                    </div>

                </div>

                <div className="px-5 py-3 border-t border-border-primary flex items-center justify-end gap-2">
                    <button
                        onClick={onCancel}
                        className="rounded-lg border border-border-primary bg-surface-surface px-3 py-2 ui-text-label text-content-muted hover:text-content-secondary"
                    >
                        {t({
                            id: "library.import.cancel",
                            message: "Cancel",
                        })}
                    </button>
                    <button
                        onClick={handleConfirm}
                        disabled={isImporting || importPaths.length === 0 || !selectedModelKey}
                        className="rounded-lg border border-border-primary bg-surface-surface px-4 py-2 ui-text-label text-content-primary hover:border-border-secondary disabled:opacity-50"
                    >
                        {isImporting
                            ? t({
                                id: "library.import.importing",
                                message: "Importing...",
                            })
                            : t({
                                id: "library.import.confirm",
                                message: "Import",
                            })}
                    </button>
                </div>
            </motion.div>
        </motion.div>
    );
};

export default LibraryImportModal;
