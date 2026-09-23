import { useLingui } from "@lingui/react/macro";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  WarningCircle as AlertCircle,
  MagnifyingGlass as Search,
  Check,
  Copy,
  Download,
  Square,
  Trash as Trash2,
  UsersThree,
  X,
} from "@phosphor-icons/react";
import { useMemo, useRef, useState } from "react";
import {
  deriveModelStats,
  formatModelSize,
  isBuiltInModel,
  modelSizeMb,
  variantLabel,
} from "../lib/modelStats";
import {
  hasModelCapability,
  MODEL_CAPABILITY_DICTIONARY,
  MODEL_CAPABILITY_STREAMING,
  MODEL_CAPABILITY_TIMESTAMPS,
} from "../lib/modelCapabilities";
import { useShiftHeld } from "../hooks/useShiftHeld";
import { useClickOutside } from "../hooks/useClickOutside";
import { useCopyToClipboard } from "../hooks/useCopyToClipboard";
import DotMatrix from "./DotMatrix";
import FilterMenu from "./FilterMenu";
import HoverTip from "./HoverTip";
import ModelCapabilityIcon, {
  CAPABILITY_ICONS,
  MODEL_CAPABILITY_ORDER,
  capabilityCopy,
  type ModelCapability,
} from "./ModelCapabilityIcon";
import type { DownloadEvent, ModelInfo } from "../../types";

const CATEGORY_ORDER = ["standard", "experimental", "legacy"] as const;
const VARIANT_ORDER = ["Q5_1", "Q5_0", "Q8_0", "Full", "Int8"];

type ModelGroup = {
  id: string;
  label: string;
  category: string;
  englishOnly: boolean;
  diarizer: boolean;
  variants: ModelInfo[];
  haystack: string;
};

const variantRank = (variant: string): number => {
  const index = VARIANT_ORDER.indexOf(variant);
  return index === -1 ? VARIANT_ORDER.length : index;
};

const groupModels = (
  catalog: ModelInfo[],
  diarizer: ModelInfo | null,
): ModelGroup[] => {
  const byId = new Map<string, ModelInfo[]>();
  for (const model of diarizer ? [...catalog, diarizer] : catalog) {
    const id = model.family;
    const list = byId.get(id);
    if (list) list.push(model);
    else byId.set(id, [model]);
  }
  const groups: ModelGroup[] = [];
  for (const [id, variants] of byId) {
    variants.sort((a, b) => variantRank(a.variant) - variantRank(b.variant));
    const first = variants[0];
    const englishOnly = deriveModelStats(first).englishOnly;
    const isDiarizer = first.key === diarizer?.key;
    // Speaker detection is not a transcription model but lists as experimental.
    const category = isDiarizer ? "experimental" : first.category;
    const label = first.label.trim();
    const haystack = [
      label,
      category,
      ...(isDiarizer ? [first.category, first.description] : []),
      ...variants.flatMap((v) => [v.engine_id, ...v.tags]),
    ]
      .join(" ")
      .toLowerCase();
    groups.push({
      id,
      label,
      category,
      englishOnly,
      diarizer: isDiarizer,
      variants,
      haystack,
    });
  }
  return groups.sort((a, b) => a.variants[0].size_mb - b.variants[0].size_mb);
};

const defaultVariantKey = (group: ModelGroup, activeKey: string): string => {
  const active = group.variants.find((v) => v.key === activeKey);
  if (active) return active.key;
  const q8 = group.variants.find((v) => v.variant === "Q8_0");
  if (q8) return q8.key;
  return group.variants[group.variants.length - 1].key;
};

type ModelPickerData = {
  catalog: ModelInfo[];
  activeKey: string;
  isInstalled: (key: string) => boolean;
  isAneInstalled?: (key: string) => boolean;
  progressFor: (key: string) => DownloadEvent | undefined;
  onUse: (key: string) => void;
  onDownload: (key: string, ane?: boolean) => void;
  onDelete: (key: string) => void;
  onCancel: (key: string) => void;
};

type ModelPickerPanelProps = ModelPickerData & {
  diarizer?: ModelInfo | null;
  className?: string;
};

export function ModelPickerPanel({
  catalog,
  activeKey,
  isInstalled,
  isAneInstalled,
  progressFor,
  onUse,
  onDownload,
  onDelete,
  onCancel,
  diarizer = null,
  className,
}: ModelPickerPanelProps) {
  const { t } = useLingui();
  const [modelSearch, setModelSearch] = useState("");
  const [quantByGroup, setQuantByGroup] = useState<Record<string, string>>({});
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [capabilityFilter, setCapabilityFilter] = useState<ModelCapability[]>(
    [],
  );
  const shiftHeld = useShiftHeld();

  const categoryLabel = (category: string) => {
    switch (category) {
      case "standard":
        return t({ id: "model_picker.category.standard", message: "Standard" });
      case "experimental":
        return t({
          id: "model_picker.category.experimental",
          message: "Experimental",
        });
      case "legacy":
        return t({ id: "model_picker.category.legacy", message: "Legacy" });
      default:
        return category;
    }
  };

  const groups = useMemo(() => {
    const listed = (model: ModelInfo) =>
      model.downloadable || isInstalled(model.key);
    return groupModels(
      catalog.filter(listed),
      diarizer && listed(diarizer) ? diarizer : null,
    );
  }, [catalog, diarizer, isInstalled]);

  const availableCategories = useMemo(() => {
    const present = new Set(groups.map((group) => group.category));
    return CATEGORY_ORDER.filter((category) => present.has(category));
  }, [groups]);

  const filteredGroups = useMemo(() => {
    const query = modelSearch.trim().toLowerCase();
    return groups.filter((group) => {
      if (categoryFilter && group.category !== categoryFilter) return false;
      if (
        !capabilityFilter.every((capability) =>
          group.variants.some((variant) =>
            hasModelCapability(variant, capability),
          ),
        )
      )
        return false;
      return query ? group.haystack.includes(query) : true;
    });
  }, [groups, modelSearch, categoryFilter, capabilityFilter]);

  const filterActive = categoryFilter !== null || capabilityFilter.length > 0;
  const toggleCapability = (capability: ModelCapability) =>
    setCapabilityFilter((prev) =>
      prev.includes(capability)
        ? prev.filter((entry) => entry !== capability)
        : [...prev, capability],
    );

  const sections = useMemo(
    () =>
      CATEGORY_ORDER.map((category) => ({
        category,
        groups: filteredGroups.filter((group) => group.category === category),
      })).filter((section) => section.groups.length > 0),
    [filteredGroups],
  );

  const renderGroup = (group: ModelGroup) => {
    const selectedKey =
      quantByGroup[group.id] ?? defaultVariantKey(group, activeKey);
    const selected =
      group.variants.find((v) => v.key === selectedKey) ?? group.variants[0];
    return (
      <ModelRow
        key={group.id}
        group={group}
        selected={selected}
        active={selected.key === activeKey}
        installed={isInstalled(selected.key)}
        aneInstalled={isAneInstalled?.(selected.key) ?? false}
        isVariantInstalled={isInstalled}
        shiftHeld={shiftHeld}
        progress={progressFor(selected.key)}
        onSelectVariant={(key) =>
          setQuantByGroup((prev) => ({ ...prev, [group.id]: key }))
        }
        onUse={group.diarizer ? undefined : () => onUse(selected.key)}
        onDownload={(ane) => onDownload(selected.key, ane)}
        onDelete={() => onDelete(selected.key)}
        onCancel={() => onCancel(selected.key)}
      />
    );
  };

  return (
    <div className={`flex min-h-0 flex-col ${className ?? ""}`}>
      <div className="px-2 pb-3 pt-0.5">
        <div className="flex items-center gap-2 rounded-lg bg-[var(--surface-interactive)] px-3 py-1.5 transition-colors focus-within:bg-[var(--surface-interactive-strong)]">
          <Search size={14} className="shrink-0 text-content-muted" />
          <input
            value={modelSearch}
            onChange={(event) => setModelSearch(event.target.value)}
            placeholder={t({
              id: "model_picker.search",
              message: "Search models",
            })}
            aria-label={t({
              id: "model_picker.search_aria",
              message: "Search models",
            })}
            className="min-w-0 flex-1 bg-transparent ui-text-body-sm ui-color-primary placeholder-content-muted outline-none"
          />

          <FilterMenu
            ariaLabel={t({
              id: "model_picker.filter.aria_v2",
              message: "Filter models",
            })}
            active={filterActive}
            triggerClassName="h-6 w-6"
            onClear={() => {
              setCategoryFilter(null);
              setCapabilityFilter([]);
            }}
            sections={[
              {
                key: "category",
                title: t({
                  id: "model_picker.filter.category",
                  message: "Category",
                }),
                items: availableCategories.map((category) => ({
                  key: category,
                  label: categoryLabel(category),
                  selected: category === categoryFilter,
                  onSelect: () =>
                    setCategoryFilter(
                      category === categoryFilter ? null : category,
                    ),
                })),
              },
              {
                key: "capabilities",
                title: t({
                  id: "model_picker.filter.capabilities",
                  message: "Capabilities",
                }),
                multiple: true,
                items: MODEL_CAPABILITY_ORDER.map((capability) => {
                  const Icon = CAPABILITY_ICONS[capability];
                  const selected = capabilityFilter.includes(capability);
                  return {
                    key: capability,
                    label: capabilityCopy(capability).label,
                    selected,
                    icon: (
                      <Icon
                        size={13}
                        className={`shrink-0 ${
                          selected ? "text-local" : "text-content-muted"
                        }`}
                        aria-hidden="true"
                      />
                    ),
                    onSelect: () => toggleCapability(capability),
                  };
                }),
              },
            ]}
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 model-list-fade">
        <div className="h-full overflow-y-auto py-3 pl-2 pr-3">
          {filteredGroups.length === 0 ? (
            <p className="py-10 text-center ui-text-body-sm text-content-muted">
              {t({
                id: "model_picker.no_matches",
                message: "No models match.",
              })}
            </p>
          ) : (
            <div className="flex flex-col">
              {sections.map((section) => (
                <div key={section.category} className="flex flex-col">
                  <div className="flex items-center gap-3 px-1 pb-1.5 pt-3 first:pt-0">
                    <span className="ui-text-body-sm-strong ui-color-secondary shrink-0">
                      {categoryLabel(section.category)}
                    </span>
                    <div
                      className="ui-divider-trailing flex-1"
                      aria-hidden="true"
                    />
                  </div>
                  {section.groups.map((group) => renderGroup(group))}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

type ModelPickerModalProps = ModelPickerData & {
  open: boolean;
  onClose: () => void;
  title?: string;
};

export default function ModelPickerModal({
  open,
  onClose,
  title,
  ...data
}: ModelPickerModalProps) {
  const { t } = useLingui();

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          key="model-picker"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-6 backdrop-blur-xs"
          onClick={onClose}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="model-picker-title"
            initial={{ scale: 0.97, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.97, opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="flex h-[34rem] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-border-primary bg-surface-tertiary ui-shadow-modal-deep"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 pt-4">
              <h2
                id="model-picker-title"
                className="ui-text-body-lg font-semibold text-content-primary"
              >
                {title ??
                  t({ id: "model_picker.title", message: "Choose a model" })}
              </h2>
              <button
                type="button"
                onClick={onClose}
                className="flex h-7 w-7 items-center justify-center rounded-md text-content-muted transition-colors hover:bg-surface-elevated hover:text-content-primary"
                aria-label={t({ id: "model_picker.close", message: "Close" })}
              >
                <X size={16} />
              </button>
            </div>

            <ModelPickerPanel {...data} className="flex-1 px-3 pt-3" />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

function ModelRow({
  group,
  selected,
  active,
  installed,
  aneInstalled,
  isVariantInstalled,
  shiftHeld,
  progress,
  onSelectVariant,
  onUse,
  onDownload,
  onDelete,
  onCancel,
}: {
  group: ModelGroup;
  selected: ModelInfo;
  active: boolean;
  installed: boolean;
  aneInstalled: boolean;
  isVariantInstalled: (key: string) => boolean;
  shiftHeld: boolean;
  progress?: DownloadEvent;
  onSelectVariant: (key: string) => void;
  onUse?: () => void;
  onDownload: (ane?: boolean) => void;
  onDelete: () => void;
  onCancel: () => void;
}) {
  const { t } = useLingui();
  const [aneUserChoice, setAneUserChoice] = useState<boolean | null>(null);
  const switchableAne = selected.ane_total_size_mb != null;
  const aneChecked = aneUserChoice ?? (aneInstalled || !installed);
  const hasDictionary = hasModelCapability(
    selected,
    MODEL_CAPABILITY_DICTIONARY,
  );
  const isStreaming = hasModelCapability(selected, MODEL_CAPABILITY_STREAMING);
  const hasTimestamps = hasModelCapability(
    selected,
    MODEL_CAPABILITY_TIMESTAMPS,
  );
  const isDownloading = progress?.status === "downloading";
  const isVerifying =
    progress?.status === "downloading" && progress.verifying === true;
  const showError = progress?.status === "error";
  const errorMessage =
    progress?.status === "error" ? progress.message : undefined;
  const isCancelled = progress?.status === "cancelled";
  const isBusy = isDownloading || showError || isCancelled;
  const percent = Math.round(progress?.percent ?? 0);
  const showQuants = group.variants.length > 1 && !isBusy;
  const aneAvailable = selected.ane_size_mb != null;
  const aneOn =
    aneAvailable && (switchableAne ? aneChecked : aneInstalled || aneChecked);
  const packageDownloadPending =
    installed &&
    aneAvailable &&
    (switchableAne ? aneOn !== aneInstalled : aneChecked && !aneInstalled);
  const showAne = aneAvailable && !isBusy;
  const displaySize = modelSizeMb(selected, aneOn);
  const downloadLabel =
    installed && !switchableAne
      ? t({
          id: "model_picker.ane.download",
          message: "Download Neural Engine encoder",
        })
      : t({ id: "model_picker.download", message: "Download" });
  const speakersLabel = t({
    id: "model_picker.diarizer.speakers",
    message: "Up to 8 speakers",
  });

  return (
    <div className="group grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-lg px-2.5 py-2 transition-colors hover:bg-surface-elevated/40">
      <button
        type="button"
        onClick={
          !installed && selected.downloadable
            ? () => onDownload(aneOn)
            : packageDownloadPending
              ? () => onDownload(aneOn)
              : onUse
        }
        title={
          packageDownloadPending
            ? downloadLabel
            : installed && !active && onUse
              ? t({ id: "model_picker.use", message: "Use" })
              : undefined
        }
        className="flex min-w-0 items-center gap-2.5 text-left"
      >
        <span
          aria-hidden="true"
          className={`h-1.5 w-1.5 shrink-0 rounded-full transition-colors ${
            active
              ? "bg-local"
              : installed
                ? "bg-content-disabled/50"
                : "bg-transparent"
          }`}
        />
        <span className="min-w-0">
          <span className="flex min-w-0 items-center gap-1.5 ui-text-body-sm-strong text-content-primary">
            <span className="truncate">{group.label}</span>
            {active && (
              <span className="sr-only">
                {" "}
                {t({ id: "model_picker.active", message: "Active" })}
              </span>
            )}
            {hasDictionary && (
              <ModelCapabilityIcon capability={MODEL_CAPABILITY_DICTIONARY} />
            )}
            {isStreaming && (
              <ModelCapabilityIcon capability={MODEL_CAPABILITY_STREAMING} />
            )}
            {hasTimestamps && (
              <ModelCapabilityIcon capability={MODEL_CAPABILITY_TIMESTAMPS} />
            )}
            {group.diarizer && (
              <HoverTip
                label={speakersLabel}
                detail={t({
                  id: "model_picker.diarizer.speakers_detail",
                  message: "Limit applies per audio track.",
                })}
                className="-m-1 inline-flex shrink-0 p-1 text-content-muted"
              >
                <UsersThree size={13} aria-label={speakersLabel} />
              </HoverTip>
            )}
          </span>
          <span className="mt-0.5 block truncate ui-text-meta tabular-nums text-content-muted">
            {group.diarizer
              ? t({
                  id: "model_picker.diarizer.description",
                  message: "Speaker diarization for Library transcripts.",
                })
              : group.englishOnly
                ? t({ id: "model_picker.english", message: "English" })
                : t({
                    id: "model_picker.multilingual",
                    message: "Multilingual",
                  })}
            {"  ·  "}
            {isBuiltInModel(selected)
              ? t({ id: "model_picker.built_in", message: "Built in" })
              : formatModelSize(displaySize)}
          </span>
        </span>
      </button>

      <div className="flex items-center justify-end gap-3">
        {showQuants && (
          <div className="inline-flex items-center overflow-hidden rounded-md border border-border-secondary">
            {group.variants.map((variant, index) => {
              const isSel = variant.key === selected.key;
              const variantInstalled = isVariantInstalled(variant.key);
              return (
                <button
                  key={variant.key}
                  type="button"
                  onClick={() => onSelectVariant(variant.key)}
                  aria-pressed={isSel}
                  className={`px-2.5 py-1 font-mono ui-text-micro tabular-nums transition-colors ${
                    index > 0 ? "border-l border-border-secondary" : ""
                  } ${isSel ? "bg-local-15" : "hover:bg-surface-elevated/60"} ${
                    variantInstalled
                      ? "text-local"
                      : isSel
                        ? "text-content-secondary"
                        : "text-content-muted hover:text-content-primary"
                  }`}
                  title={
                    variantInstalled
                      ? t({
                          id: "model_picker.variant_installed",
                          message: "Model variant (installed)",
                        })
                      : t({
                          id: "model_picker.variant",
                          message: "Model variant",
                        })
                  }
                >
                  {variantLabel(variant.variant)}
                </button>
              );
            })}
          </div>
        )}

        {showAne && (
          <AneCheckbox
            checked={aneOn}
            installed={aneInstalled && !switchableAne}
            onToggle={() => setAneUserChoice(!aneChecked)}
          />
        )}

        {isBusy ? (
          <>
            <div className="flex w-[140px] flex-col items-end justify-center">
              <ModelProgressDots percent={percent} status={progress!.status} />
              <div className="mt-1 flex h-3 w-full items-center justify-end">
                {isVerifying ? (
                  <p className="truncate text-right ui-text-micro tabular-nums text-content-disabled">
                    {t({
                      id: "models.card.verifying",
                      message: "Verifying install",
                    })}
                  </p>
                ) : isDownloading ? (
                  <p className="truncate text-right ui-text-micro tabular-nums text-content-disabled">
                    {percent}% ·{" "}
                    {
                      (
                        progress as Extract<
                          DownloadEvent,
                          { status: "downloading" }
                        >
                      ).file
                    }
                  </p>
                ) : null}
                {showError && errorMessage && (
                  <DownloadErrorPopover message={errorMessage} />
                )}
                {isCancelled && (
                  <p className="text-right ui-text-micro text-content-disabled">
                    {t({ id: "model_picker.cancelled", message: "Cancelled" })}
                  </p>
                )}
              </div>
            </div>
            <div className="flex w-7 shrink-0 items-center justify-end">
              {isDownloading && (
                <button
                  type="button"
                  onClick={onCancel}
                  className="flex h-6 w-6 items-center justify-center rounded-md text-error transition-colors hover:bg-error/10"
                  title={t({ id: "model_picker.cancel", message: "Cancel" })}
                >
                  <Square size={10} fill="currentColor" aria-hidden="true" />
                </button>
              )}
            </div>
          </>
        ) : (
          <div className="flex items-center gap-1">
            <span className="flex h-6 w-6 items-center justify-center">
              {((!installed && selected.downloadable) ||
                (showAne && packageDownloadPending)) && (
                <button
                  type="button"
                  onClick={() => onDownload(aneOn)}
                  className="flex h-6 w-6 items-center justify-center rounded-md text-content-secondary transition-colors hover:bg-surface-elevated/60 hover:text-content-primary"
                  title={downloadLabel}
                  aria-label={downloadLabel}
                >
                  <Download size={13} aria-hidden="true" />
                </button>
              )}
            </span>
            <span className="flex h-6 w-6 items-center justify-center">
              {installed && (
                <button
                  type="button"
                  onClick={onDelete}
                  className={`flex h-6 w-6 items-center justify-center rounded-md transition-all hover:bg-error/10 hover:text-error ${
                    shiftHeld
                      ? "text-error opacity-100"
                      : "text-content-disabled opacity-0 group-hover:opacity-100 focus-visible:opacity-100 focus-visible:text-error"
                  }`}
                  title={t({ id: "model_picker.delete", message: "Delete" })}
                  aria-label={t({
                    id: "model_picker.delete",
                    message: "Delete",
                  })}
                >
                  <Trash2 size={12} aria-hidden="true" />
                </button>
              )}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function AneCheckbox({
  checked,
  installed,
  onToggle,
}: {
  checked: boolean;
  installed: boolean;
  onToggle: () => void;
}) {
  const { t } = useLingui();

  return (
    <HoverTip
      label={t({
        id: "model_picker.ane.title",
        message: "Apple Neural Engine",
      })}
      detail={t({
        id: "model_picker.ane.detail",
        message:
          "Runs the encoder on the Neural Engine. Faster and uses less power. First load takes longer while macOS optimizes it.",
      })}
      className="flex items-center"
    >
      <button
        type="button"
        role="checkbox"
        aria-checked={checked}
        disabled={installed}
        onClick={onToggle}
        aria-label={
          installed
            ? t({
                id: "model_picker.ane.installed",
                message: "Neural Engine encoder installed",
              })
            : t({
                id: "model_picker.ane.toggle",
                message: "Include the Apple Neural Engine encoder",
              })
        }
        className="flex items-center gap-1.5 rounded-md px-1 py-0.5 transition-colors enabled:hover:bg-surface-elevated/60 disabled:cursor-default"
      >
        <span
          aria-hidden="true"
          className={`flex h-3.5 w-3.5 items-center justify-center rounded-[3px] border transition-colors ${
            checked
              ? "border-local bg-local-15 text-local"
              : "border-border-secondary text-transparent"
          }`}
        >
          {checked && <Check size={9} weight="bold" />}
        </span>
        <span
          className={`font-mono ui-text-micro ${
            installed
              ? "text-local"
              : checked
                ? "text-content-secondary"
                : "text-content-muted"
          }`}
        >
          ANE
        </span>
      </button>
    </HoverTip>
  );
}

function DownloadErrorPopover({ message }: { message: string }) {
  const { t } = useLingui();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { copied, copy, reset } = useCopyToClipboard(1500);
  useClickOutside(
    ref,
    () => {
      setOpen(false);
      reset();
    },
    open,
  );

  const copyLabel = copied
    ? t({ id: "model_picker.error.copied", message: "Copied" })
    : t({ id: "model_picker.error.copy", message: "Copy error message" });

  return (
    <div className="relative flex w-full justify-end" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        title={t({
          id: "model_picker.error.show",
          message: "Show error details",
        })}
        className="flex min-w-0 max-w-full items-center gap-1 rounded-sm ui-text-micro text-error transition-opacity hover:opacity-80"
      >
        <AlertCircle size={9} className="shrink-0" aria-hidden="true" />
        <span className="truncate">{message}</span>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            role="dialog"
            aria-label={t({
              id: "model_picker.error.title",
              message: "Download failed",
            })}
            initial={{ opacity: 0, scale: 0.98, y: -2 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: -2 }}
            transition={{ duration: 0.12 }}
            className="ui-surface-menu absolute right-0 top-full z-30 mt-1 flex w-64 items-start gap-1.5 py-1.5 pl-2.5 pr-1.5"
          >
            <p className="min-w-0 flex-1 select-text break-words font-mono ui-text-micro leading-snug text-content-secondary">
              {message}
            </p>
            <button
              type="button"
              onClick={() => void copy(message)}
              title={copyLabel}
              aria-label={copyLabel}
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-content-muted transition-colors hover:bg-surface-elevated/60 hover:text-content-primary"
            >
              {copied ? (
                <Check size={11} aria-hidden="true" />
              ) : (
                <Copy size={11} aria-hidden="true" />
              )}
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ModelProgressDots({
  percent,
  status,
}: {
  percent: number;
  status: DownloadEvent["status"];
}) {
  const cols = 36;
  const rows = 2;
  const total = cols * rows;
  const activeCount = Math.min(Math.round((percent / 100) * total), total);
  const activeDots = Array.from({ length: activeCount }, (_, i) => i);
  const color =
    status === "error"
      ? "var(--color-error)"
      : status === "complete"
        ? "var(--color-success)"
        : "var(--color-local)";
  return (
    <DotMatrix
      rows={rows}
      cols={cols}
      activeDots={activeDots}
      dotSize={2}
      gap={2}
      color={color}
      className={status === "downloading" ? "opacity-80" : "opacity-60"}
      morphOnActive
      activeScale={1}
    />
  );
}
