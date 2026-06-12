import { useLingui } from "@lingui/react/macro";
import { useEffect, useMemo, useState, type MouseEvent } from "react";
import { motion } from "framer-motion";
import { X, Warning } from "@phosphor-icons/react";
import { Dropdown, type DropdownOption } from "../../../shared/ui/Dropdown";
import ToggleSwitch from "../../../shared/ui/ToggleSwitch";
import {
  hasModelCapability,
  MODEL_CAPABILITY_TIMESTAMPS,
} from "../../../shared/lib/modelCapabilities";
import type { LibraryItem, SpeechModel } from "../../../types";

type LibraryRetranscribeOptions = {
  model_key: string;
  show_timestamps: boolean;
};

type LibraryRetranscribeModalProps = {
  item: LibraryItem;
  models: SpeechModel[];
  onCancel: () => void;
  onConfirm: (options: LibraryRetranscribeOptions) => Promise<void>;
};

const LibraryRetranscribeModal = ({
  item,
  models,
  onCancel,
  onConfirm,
}: LibraryRetranscribeModalProps) => {
  const { t } = useLingui();
  const [selectedModelKey, setSelectedModelKey] = useState<string>(
    item.speech_model,
  );
  const [showTimestamps, setShowTimestamps] = useState(item.show_timestamps);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const modelOptions: DropdownOption<string>[] = useMemo(
    () =>
      models.map((model) => ({
        value: model.id,
        label: model.label,
        description: model.remote
          ? t({
              id: "library.retranscribe.remote_provider",
              message: "Remote provider",
            })
          : model.description,
      })),
    [models, t],
  );

  useEffect(() => {
    const available = new Set(modelOptions.map((option) => option.value));
    const nextModel = available.has(item.speech_model)
      ? item.speech_model
      : (modelOptions[0]?.value ?? "");
    setSelectedModelKey(nextModel);
    setShowTimestamps(item.show_timestamps);
  }, [item.id, item.speech_model, item.show_timestamps, modelOptions]);

  const selectedModel =
    models.find((model) => model.id === selectedModelKey) ?? null;
  const timestampsSupported =
    Boolean(selectedModel?.remote) ||
    hasModelCapability(selectedModel, MODEL_CAPABILITY_TIMESTAMPS);

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
      className="fixed inset-0 z-[95] flex items-center justify-center bg-black/60 px-6 backdrop-blur-xs"
      onClick={onCancel}
      role="dialog"
      aria-modal="true"
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 12 }}
        transition={{ duration: 0.2, ease: "easeOut" }}
        className="relative w-[440px] max-w-[92vw] rounded-2xl border border-border-primary bg-surface-tertiary ui-shadow-modal-deep"
        onClick={(e: MouseEvent<HTMLDivElement>) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between px-5 pt-4">
          <div className="min-w-0">
            <h2 className="ui-text-body-lg font-semibold text-content-primary">
              {t({
                id: "library.retranscribe.title",
                message: "Retranscribe",
              })}
            </h2>
            <p className="mt-0.5 truncate ui-text-meta text-content-muted">
              {item.name}
            </p>
          </div>
          <button
            onClick={onCancel}
            aria-label={t({
              id: "library.retranscribe.close",
              message: "Close",
            })}
            className="ml-3 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-content-muted transition-colors hover:bg-surface-elevated hover:text-content-primary"
          >
            <X size={14} aria-hidden="true" />
          </button>
        </div>

        <div className="flex flex-col gap-5 px-5 py-5">
          {modelOptions.length === 0 && (
            <div className="flex items-start gap-2 ui-text-body-sm ui-color-warning-strong">
              <Warning size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
              <span>
                {t({
                  id: "library.retranscribe.no_models",
                  message:
                    "No models available. Configure a remote provider or download a local model in Settings -> Models before retranscribing.",
                })}
              </span>
            </div>
          )}

          <div>
            <label className="ui-text-label text-content-muted">
              {t({
                id: "library.retranscribe.model",
                message: "Model",
              })}
            </label>
            <div className="mt-1.5">
              <Dropdown
                value={selectedModelKey || null}
                onChange={(value) => setSelectedModelKey(value)}
                options={modelOptions}
                placeholder={t({
                  id: "library.retranscribe.select_model",
                  message: "Select a model",
                })}
                searchable
                searchPlaceholder={t({
                  id: "library.retranscribe.search_models",
                  message: "Search installed models...",
                })}
              />
            </div>
          </div>

          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="ui-text-body-sm text-content-primary">
                {t({
                  id: "library.retranscribe.show_timestamps",
                  message: "Show timestamps",
                })}
              </div>
              <div className="ui-text-meta text-content-disabled">
                {timestampsSupported
                  ? t({
                      id: "library.retranscribe.timestamps_supported",
                      message: "Enabled for supported models",
                    })
                  : t({
                      id: "library.retranscribe.timestamps_unsupported",
                      message: "Not supported by this model",
                    })}
              </div>
            </div>
            <ToggleSwitch
              enabled={showTimestamps}
              onToggle={() =>
                timestampsSupported && setShowTimestamps(!showTimestamps)
              }
              ariaLabel={t({
                id: "library.retranscribe.show_timestamps.aria",
                message: "Show timestamps",
              })}
              disabled={!timestampsSupported}
              size="md"
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-5 pb-4">
          <button
            onClick={onCancel}
            className="rounded-lg px-3 py-2 ui-text-body-sm font-medium text-content-muted transition-colors hover:text-content-primary"
          >
            {t({
              id: "library.retranscribe.cancel",
              message: "Cancel",
            })}
          </button>
          <button
            onClick={handleConfirm}
            disabled={isSubmitting || !selectedModelKey}
            className="rounded-lg bg-amber-400 px-4 py-2 ui-text-body-sm font-semibold ui-color-on-warning transition-colors hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSubmitting
              ? t({
                  id: "library.retranscribe.loading",
                  message: "Retranscribing...",
                })
              : t({
                  id: "library.retranscribe.confirm",
                  message: "Retranscribe",
                })}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
};

export default LibraryRetranscribeModal;
