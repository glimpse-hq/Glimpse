import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { X } from "lucide-react";
import { Dropdown, type DropdownOption } from "../Dropdown";
import { hasModelCapability, MODEL_CAPABILITY_TIMESTAMPS } from "../../lib/modelCapabilities";
import type { LibraryItem, ModelInfo } from "../../types";

const isTimestampSupported = (model?: ModelInfo | null) =>
    hasModelCapability(model, MODEL_CAPABILITY_TIMESTAMPS);

export type LibraryRetranscribeOptions = {
    model_key: string;
    show_timestamps: boolean;
};

type LibraryRetranscribeModalProps = {
    item: LibraryItem;
    models: ModelInfo[];
    onCancel: () => void;
    onConfirm: (options: LibraryRetranscribeOptions) => Promise<void>;
};

const LibraryRetranscribeModal = ({
    item,
    models,
    onCancel,
    onConfirm,
}: LibraryRetranscribeModalProps) => {
    const [selectedModelKey, setSelectedModelKey] = useState<string>(item.speech_model);
    const [showTimestamps, setShowTimestamps] = useState(item.show_timestamps);
    const [isSubmitting, setIsSubmitting] = useState(false);

    const modelOptions: DropdownOption<string>[] = useMemo(() => {
        return models.map((model) => ({
            value: model.key,
            label: model.label,
            description: model.description,
        }));
    }, [models]);

    useEffect(() => {
        const installed = new Set(models.map((model) => model.key));
        const fallback = modelOptions[0]?.value ?? "";
        const nextModel = installed.has(item.speech_model) ? item.speech_model : fallback;
        setSelectedModelKey(nextModel);
        setShowTimestamps(item.show_timestamps);
    }, [item.id, item.speech_model, item.show_timestamps, modelOptions, models]);

    const selectedModel = models.find((model) => model.key === selectedModelKey) ?? null;
    const timestampsSupported = isTimestampSupported(selectedModel);

    useEffect(() => {
        if (!timestampsSupported) {
            setShowTimestamps(false);
        }
    }, [timestampsSupported]);

    const handleConfirm = async () => {
        if (!selectedModelKey) return;
        setIsSubmitting(true);
        try {
            await onConfirm({
                model_key: selectedModelKey,
                show_timestamps: timestampsSupported ? showTimestamps : false,
            });
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-[95] flex items-center justify-center bg-black/70 backdrop-blur-sm"
            onClick={onCancel}
            role="dialog"
            aria-modal="true"
        >
            <motion.div
                initial={{ opacity: 0, scale: 0.96, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.96, y: 20 }}
                transition={{ duration: 0.2, ease: "easeOut" }}
                className="relative w-[420px] max-w-[92vw] bg-surface-overlay border border-border-secondary rounded-2xl shadow-2xl"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-center justify-between px-5 py-3 border-b border-border-primary">
                    <div>
                        <p className="ui-text-meta uppercase tracking-[0.2em] text-content-disabled">Retranscribe</p>
                        <p className="ui-text-body-lg text-content-primary mt-1 truncate">{item.name}</p>
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
                            No local models are installed. Download a model in Settings → Models before retranscribing.
                        </div>
                    )}
                    <div>
                        <label className="ui-text-label font-medium text-content-muted ml-1">Model</label>
                        <Dropdown
                            value={selectedModelKey || null}
                            onChange={(value) => setSelectedModelKey(value)}
                            options={modelOptions}
                            placeholder="Select a model"
                            searchable
                            searchPlaceholder="Search installed models..."
                        />
                    </div>

                    <div className="flex items-center justify-between rounded-lg border border-border-primary bg-surface-surface px-4 py-3">
                        <div>
                            <div className="ui-text-body-sm text-content-primary font-medium">Show timestamps</div>
                            <div className="ui-text-meta text-content-disabled">
                                {timestampsSupported ? "Enabled for supported models" : "Not supported by this model"}
                            </div>
                        </div>
                        <button
                            onClick={() => timestampsSupported && setShowTimestamps(!showTimestamps)}
                            className={`relative w-10 h-5 rounded-full transition-colors ${showTimestamps ? "bg-cloud" : "bg-border-secondary"} ${!timestampsSupported ? "opacity-40 cursor-not-allowed" : ""}`}
                            role="switch"
                            aria-checked={showTimestamps}
                            disabled={!timestampsSupported}
                        >
                            <motion.div
                                className="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm"
                                animate={{ left: showTimestamps ? "calc(100% - 18px)" : "2px" }}
                                transition={{ type: "spring", stiffness: 500, damping: 30 }}
                            />
                        </button>
                    </div>

                </div>

                <div className="px-5 py-3 border-t border-border-primary flex items-center justify-end gap-2">
                    <button
                        onClick={onCancel}
                        className="rounded-lg border border-border-primary bg-surface-surface px-3 py-2 ui-text-label text-content-muted hover:text-content-secondary"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleConfirm}
                        disabled={isSubmitting || !selectedModelKey}
                        className="rounded-lg border border-border-primary bg-surface-surface px-4 py-2 ui-text-label text-content-primary hover:border-border-secondary disabled:opacity-50"
                    >
                        {isSubmitting ? "Retranscribing..." : "Retranscribe"}
                    </button>
                </div>
            </motion.div>
        </motion.div>
    );
};

export default LibraryRetranscribeModal;
