import { useLingui } from "@lingui/react/macro";
import { Trash as Trash2 } from "@phosphor-icons/react";
import { formatModelSize } from "../../../shared/lib/modelStats";
import DotMatrix from "../../../shared/ui/DotMatrix";
import type { ModelInfo } from "../../../types";
import ModelCardShell from "./ModelCardShell";

type Props = {
  model: ModelInfo;
  onDelete: () => void;
};

const DiarizationModelCard = ({ model, onDelete }: Props) => {
  const { t } = useLingui();
  const personDots = [1, 3, 4, 5, 7];

  return (
    <ModelCardShell
      accent="var(--model-wave-nvidia)"
      glowStrong="var(--model-wave-glow-strong-nvidia)"
      glowSoft="var(--model-wave-glow-soft-nvidia)"
      heroContent={
        <div
          aria-hidden="true"
          className="flex w-full items-center justify-center gap-8"
        >
          <div className="-translate-y-0.5 -rotate-6">
            <DotMatrix
              rows={3}
              cols={3}
              activeDots={personDots}
              dotSize={3}
              gap={3}
              color="var(--color-local)"
            />
          </div>
          <div className="translate-y-1 rotate-3">
            <DotMatrix
              rows={3}
              cols={3}
              activeDots={personDots}
              dotSize={3}
              gap={3}
              color="var(--color-cloud)"
            />
          </div>
          <div className="-translate-y-1 rotate-6">
            <DotMatrix
              rows={3}
              cols={3}
              activeDots={personDots}
              dotSize={3}
              gap={3}
              color="var(--color-success)"
            />
          </div>
        </div>
      }
      ariaLabel={t({
        id: "settings.models.diarization.aria",
        message: "Local person detection model",
      })}
      width={240}
      heroHeight={48}
      borderRadius={14}
      dotSize={2}
      dotGap={4}
    >
      <div className="px-3.5 pb-2.5 pt-2.5">
        <p className="mb-1.5 text-[8.5px] font-semibold uppercase leading-none tracking-[0.08em] text-local">
          {t({
            id: "settings.models.diarization.addon",
            message: "Add-on",
          })}
        </p>
        <h3
          className="line-clamp-2 min-w-0 ui-color-primary"
          style={{
            fontSize: "0.875rem",
            fontWeight: 650,
            letterSpacing: "-0.015em",
            lineHeight: 1.15,
          }}
        >
          {t({
            id: "settings.models.diarization.title",
            message: "Local person detection",
          })}
        </h3>

        <div className="mt-1 flex min-h-6 items-center justify-between gap-1.5">
          <p className="line-clamp-2 min-w-0 font-mono text-[9.5px] leading-tight tabular-nums ui-color-muted">
            {t({
              id: "settings.models.diarization.local_private",
              message: "Local",
            })}
            {"  ·  "}
            {formatModelSize(model.size_mb)}
          </p>
          <button
            type="button"
            onClick={onDelete}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[5px] text-content-disabled transition-colors hover:bg-error/10 hover:text-error"
            title={t({ id: "models.card.delete", message: "Delete" })}
            aria-label={t({
              id: "settings.models.diarization.delete",
              message: "Delete local person detection",
            })}
          >
            <Trash2 size={11} aria-hidden="true" />
          </button>
        </div>
      </div>
    </ModelCardShell>
  );
};

export default DiarizationModelCard;
