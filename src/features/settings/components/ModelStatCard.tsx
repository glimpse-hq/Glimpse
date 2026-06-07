import { useMemo } from "react";
import { useLingui } from "@lingui/react/macro";
import {
  Download,
  Square,
  Trash as Trash2,
} from "@phosphor-icons/react";
import DotMatrix from "../../../shared/ui/DotMatrix";
import ActivityDots from "../../../shared/ui/ActivityDots";
import { deriveModelStats, formatModelSize } from "../../../shared/lib/modelStats";
import type { DownloadEvent, ModelInfo, ModelStatus } from "../../../types";

const CARD_WIDTH = 300;
const WAVE_ROWS = 13;
const WAVE_COLS = 44;
const WAVE_CENTER = (WAVE_ROWS - 1) / 2;

const FEATHER_MASK =
  "radial-gradient(closest-side, #000 0%, #000 52%, transparent 100%)";

const BLUR_LAYERS = [
  { blur: 1, mask: "radial-gradient(closest-side, transparent 50%, #000 92%)" },
  { blur: 2.5, mask: "radial-gradient(closest-side, transparent 68%, #000 100%)" },
  { blur: 5, mask: "radial-gradient(closest-side, transparent 84%, #000 108%)" },
];

const waveDots = (seedSource: string): number[] => {
  let h = 2166136261;
  for (let i = 0; i < seedSource.length; i++) {
    h ^= seedSource.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const active: number[] = [];
  for (let col = 0; col < WAVE_COLS; col++) {
    h = Math.imul(h ^ (col + 1), 16777619);
    const amp = (h >>> 8) % (WAVE_CENTER + 1);
    for (let d = -amp; d <= amp; d++) {
      active.push((WAVE_CENTER + d) * WAVE_COLS + col);
    }
  }
  return active;
};

type ModelStatCardProps = {
  model: ModelInfo;
  status?: ModelStatus;
  progress?: DownloadEvent;
  onDownload: () => void;
  onDelete: () => void;
  onCancel: () => void;
};

const ModelStatCard = ({
  model,
  status,
  progress,
  onDownload,
  onDelete,
  onCancel,
}: ModelStatCardProps) => {
  const { t } = useLingui();
  const stats = deriveModelStats(model);

  const facts = [stats.languagesLabel];
  facts.push(formatModelSize(model.size_mb));

  const installed = status?.installed;
  const isDownloading = progress?.status === "downloading";
  const percent = progress?.percent ?? 0;
  const isVerifying =
    progress?.status === "downloading" && progress.verifying === true;

  const fullDots = useMemo(() => waveDots(model.key), [model.key]);
  const revealCols = installed
    ? WAVE_COLS
    : isDownloading
      ? Math.round((percent / 100) * WAVE_COLS)
      : 0;
  const dots = fullDots.filter((idx) => idx % WAVE_COLS < revealCols);

  const isNvidia = model.engine_id === "nvidia";
  const accent = isNvidia
    ? "var(--model-wave-nvidia)"
    : "var(--model-wave-whisper)";
  const glowStrong = isNvidia
    ? "var(--model-wave-glow-strong-nvidia)"
    : "var(--model-wave-glow-strong-whisper)";
  const glowSoft = isNvidia
    ? "var(--model-wave-glow-soft-nvidia)"
    : "var(--model-wave-glow-soft-whisper)";

  return (
    <article
      className="relative overflow-hidden bg-surface-surface text-left"
      style={{
        width: `${CARD_WIDTH}px`,
        borderRadius: "18px",
        border: "1px solid var(--color-border-secondary, rgba(0,0,0,0.08))",
        boxShadow:
          "0 1px 2px rgba(0,0,0,0.05), 0 16px 40px -20px rgba(0,0,0,0.45)",
      }}
      aria-label={t({ id: "models.card.aria", message: `${model.label} model` })}
    >
      <div
        className="relative flex items-center justify-center overflow-hidden"
        style={{
          height: "92px",
          background: `radial-gradient(120% 140% at 50% -20%, ${glowStrong}, transparent 70%), linear-gradient(180deg, ${glowSoft}, transparent)`,
        }}
      >
        <div
          className="absolute inset-0 flex items-center justify-center"
          style={{
            WebkitMaskImage: FEATHER_MASK,
            maskImage: FEATHER_MASK,
          }}
        >
          <DotMatrix
            rows={WAVE_ROWS}
            cols={WAVE_COLS}
            activeDots={dots}
            dotSize={3}
            gap={5}
            color={accent}
            animated={isDownloading}
          />
        </div>

        {BLUR_LAYERS.map((layer) => (
          <div
            key={layer.blur}
            aria-hidden="true"
            className="pointer-events-none absolute inset-0"
            style={{
              backdropFilter: `blur(${layer.blur}px)`,
              WebkitBackdropFilter: `blur(${layer.blur}px)`,
              WebkitMaskImage: layer.mask,
              maskImage: layer.mask,
            }}
          />
        ))}
      </div>

      <div className="px-5 pb-4 pt-3.5">
        <h3
          className="ui-color-primary"
          style={{
            fontSize: "1.1875rem",
            fontWeight: 650,
            letterSpacing: "-0.015em",
          }}
        >
          {model.label}
        </h3>

        <div className="mt-2 flex items-center justify-between gap-2">
          <p
            className="ui-color-muted font-mono tabular-nums"
            style={{ fontSize: "11.5px" }}
          >
            {isVerifying
              ? t({ id: "models.card.verifying", message: "Verifying download" })
              : isDownloading
                ? t({ id: "models.card.downloading", message: "Downloading" })
                : facts.join("  ·  ")}
          </p>

          {isDownloading ? (
            <div className="flex shrink-0 items-center gap-1.5">
              {isVerifying ? (
                <ActivityDots />
              ) : (
                <span
                  className="font-mono tabular-nums ui-color-primary"
                  style={{ fontSize: "11.5px" }}
                >
                  {Math.round(percent)}%
                </span>
              )}
              <button
                type="button"
                onClick={onCancel}
                className="flex h-7 w-7 items-center justify-center rounded-md text-error transition-colors hover:bg-error/10"
                title={t({ id: "models.card.cancel", message: "Cancel" })}
                aria-label={t({
                  id: "models.card.cancel_download",
                  message: "Cancel download",
                })}
              >
                <Square size={11} fill="currentColor" aria-hidden="true" />
              </button>
            </div>
          ) : installed ? (
            <button
              type="button"
              onClick={onDelete}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-content-disabled transition-colors hover:bg-error/10 hover:text-error"
              title={t({ id: "models.card.delete", message: "Delete" })}
              aria-label={t({
                id: "models.card.delete_model",
                message: "Delete model",
              })}
            >
              <Trash2 size={13} aria-hidden="true" />
            </button>
          ) : (
            <button
              type="button"
              onClick={onDownload}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--color-success)] transition-colors hover:bg-[color-mix(in_srgb,var(--color-success)_12%,transparent)]"
              title={t({ id: "models.card.download", message: "Download" })}
              aria-label={t({
                id: "models.card.download_model",
                message: "Download model",
              })}
            >
              <Download size={13} aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
    </article>
  );
};

export default ModelStatCard;
