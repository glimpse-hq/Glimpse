import { plural } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Check, Loader2 } from "lucide-react";
import type { StepMotionProps } from "../../onboarding/steps/shared";
import { settingsKeys } from "../../settings/queries";
import { transcriptionKeys } from "../../transcriptions/queries";
import { useQueryClient, useMutation } from "@tanstack/react-query";
import { formatShortcutForDisplay } from "../../../shared/lib/shortcuts";
import { useImportPreview } from "../queries";
import { applyImport } from "../api";
import type {
  DetectedApp,
  ImportResult,
  ImportSelections,
} from "../../../types";

type CategoryKey = keyof ImportSelections;

type Category = {
  key: CategoryKey;
  label: string;
  detail: string;
};

interface ImportStepProps {
  stepMotionProps: StepMotionProps;
  apps: DetectedApp[];
  onApplied: (result: ImportResult) => void;
  onNext: () => void;
}

const ALL_ON: ImportSelections = {
  dictionary: true,
  replacements: true,
  personalities: true,
  shortcut: true,
  language: true,
  autoLaunch: true,
  model: true,
  history: true,
};

const MAX_CATEGORIES = 8;

export function ImportStep({
  stepMotionProps,
  apps,
  onApplied,
  onNext,
}: ImportStepProps) {
  const { t } = useLingui();
  const queryClient = useQueryClient();

  const [selectedAppId, setSelectedAppId] = useState<string | null>(
    apps[0]?.id ?? null,
  );
  const previewQuery = useImportPreview(selectedAppId);
  const preview = previewQuery.data;
  const previewForApp =
    preview && preview.id === selectedAppId ? preview : undefined;
  const isLoadingPreview =
    previewQuery.isLoading ||
    (previewQuery.isFetching && previewForApp === undefined);

  const [selections, setSelections] = useState<ImportSelections>(ALL_ON);

  useEffect(() => {
    setSelections(ALL_ON);
  }, [selectedAppId]);

  const categories = useMemo<Category[]>(() => {
    if (!previewForApp) return [];
    const rows: Category[] = [];
    if (previewForApp.dictionaryCount > 0) {
      rows.push({
        key: "dictionary",
        label: t({ id: "import.cat.dictionary", message: "Dictionary" }),
        detail: t({
          id: "import.cat.dictionary.detail",
          message: plural(previewForApp.dictionaryCount, {
            one: "# word",
            other: "# words",
          }),
        }),
      });
    }
    if (previewForApp.replacementsCount > 0) {
      rows.push({
        key: "replacements",
        label: t({ id: "import.cat.replacements", message: "Text replacements" }),
        detail: t({
          id: "import.cat.replacements.detail",
          message: plural(previewForApp.replacementsCount, {
            one: "# rule",
            other: "# rules",
          }),
        }),
      });
    }
    if (previewForApp.personalitiesCount > 0) {
      rows.push({
        key: "personalities",
        label: t({ id: "import.cat.personalities", message: "Personalities" }),
        detail: t({
          id: "import.cat.personalities.detail",
          message: plural(previewForApp.personalitiesCount, {
            one: "# saved",
            other: "# saved",
          }),
        }),
      });
    }
    if (previewForApp.transcriptCount > 0) {
      rows.push({
        key: "history",
        label: t({ id: "import.cat.history", message: "Transcript history" }),
        detail: t({
          id: "import.cat.history.detail",
          message: plural(previewForApp.transcriptCount, {
            one: "# transcript",
            other: "# transcripts",
          }),
        }),
      });
    }
    if (previewForApp.shortcut) {
      rows.push({
        key: "shortcut",
        label: t({ id: "import.cat.shortcut", message: "Keyboard shortcut" }),
        detail: formatShortcutForDisplay(previewForApp.shortcut),
      });
    }
    if (previewForApp.language) {
      rows.push({
        key: "language",
        label: t({ id: "import.cat.language", message: "Language" }),
        detail: previewForApp.language,
      });
    }
    if (previewForApp.autoLaunch !== null) {
      rows.push({
        key: "autoLaunch",
        label: t({ id: "import.cat.auto_launch", message: "Launch at login" }),
        detail: previewForApp.autoLaunch
          ? t({ id: "import.cat.auto_launch.on", message: "On" })
          : t({ id: "import.cat.auto_launch.off", message: "Off" }),
      });
    }
    if (previewForApp.modelRecognized && previewForApp.modelKey) {
      rows.push({
        key: "model",
        label: t({ id: "import.cat.model", message: "Transcription model" }),
        detail: previewForApp.modelKey,
      });
    }
    return rows;
  }, [previewForApp, t]);

  const applyMutation = useMutation({
    mutationFn: () => applyImport(selectedAppId as string, selections),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: settingsKeys.all });
      if (result.transcriptsAdded > 0) {
        void queryClient.invalidateQueries({ queryKey: transcriptionKeys.all });
      }
      onApplied(result);
    },
  });

  const toggle = (key: CategoryKey) =>
    setSelections((prev) => ({ ...prev, [key]: !prev[key] }));

  const hasItems = categories.length > 0;
  const selectedCount = categories.filter((c) => selections[c.key]).length;
  const showAppPicker = apps.length > 1;
  const sourceName = apps.find((a) => a.id === selectedAppId)?.name;

  const skeletonRows = (
    <div className="divide-y divide-border-primary/40">
      {Array.from({ length: MAX_CATEGORIES }).map((_, i) => (
        <div key={i} className="flex items-center gap-3.5 py-3.5">
          <div className="h-5 w-5 shrink-0 rounded-full bg-surface-overlay animate-pulse" />
          <div className="h-3 flex-1 max-w-[9rem] rounded bg-surface-overlay animate-pulse" />
        </div>
      ))}
    </div>
  );

  const categoryRows = (
    <div className="divide-y divide-border-primary/40">
      {categories.map((cat) => {
        const checked = selections[cat.key];
        return (
          <button
            key={cat.key}
            type="button"
            onClick={() => toggle(cat.key)}
            className="group flex w-full items-center gap-3.5 py-3.5"
            aria-pressed={checked}
          >
            <span
              className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full transition-colors ${
                checked
                  ? "bg-accent text-white"
                  : "border border-border-secondary group-hover:border-accent-50"
              }`}
            >
              <Check
                size={12}
                strokeWidth={3}
                className={checked ? "opacity-100" : "opacity-0"}
              />
            </span>

            <span className="flex min-w-0 flex-1 items-baseline justify-between gap-3">
              <span
                className={`ui-text-label font-medium transition-colors ${
                  checked ? "text-content-primary" : "text-content-muted"
                }`}
              >
                {cat.label}
              </span>
              <span className="ui-text-meta text-content-muted truncate text-right">
                {cat.detail}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );

  const previewContent = previewQuery.isError ? (
    <p className="py-6 text-center ui-text-label text-content-muted text-balance">
      {t({
        id: "import.error",
        message:
          "We couldn't read this app's data. You can skip and set things up manually.",
      })}
    </p>
  ) : !hasItems ? (
    <p className="py-6 text-center ui-text-label text-content-muted">
      {t({ id: "import.empty", message: "Nothing to bring over from this app." })}
    </p>
  ) : (
    categoryRows
  );

  return (
    <motion.div
      key="import"
      {...stepMotionProps}
      initial="enter"
      className="flex w-full max-w-md flex-col items-center text-center"
    >
      <h2 className="ui-text-title-lg font-semibold text-content-primary mb-2">
        {t({ id: "import.title", message: "Bring your setup over" })}
      </h2>

      <p className="ui-text-body-lg text-content-muted mb-8 text-balance">
        {!showAppPicker && sourceName
          ? t({
              id: "import.subtitle.single",
              message: `We noticed you use ${sourceName}. Pick what to carry over.`,
            })
          : t({
              id: "import.subtitle",
              message: "Pick what to carry over from your other app.",
            })}
      </p>

      {showAppPicker && (
        <div className="mb-7 flex w-full flex-wrap justify-center gap-2">
          {apps.map((app) => {
            const selected = selectedAppId === app.id;
            return (
              <button
                key={app.id}
                type="button"
                onClick={() => setSelectedAppId(app.id)}
                aria-pressed={selected}
                className={`rounded-full px-4 py-1.5 ui-text-label font-medium transition-colors ${
                  selected
                    ? "bg-accent-10 text-accent"
                    : "text-content-muted hover:text-content-secondary"
                }`}
              >
                {app.name}
              </button>
            );
          })}
        </div>
      )}

      <div className="relative w-full text-left">
        <div aria-hidden className="divide-y divide-border-primary/40 invisible pointer-events-none">
          {Array.from({ length: MAX_CATEGORIES }).map((_, i) => (
            <div key={i} className="flex items-center gap-3.5 py-3.5">
              <span className="h-5 w-5 shrink-0" />
              <span className="ui-text-label">&nbsp;</span>
            </div>
          ))}
        </div>

        <div className="absolute inset-0">
          <div
            className={`absolute inset-x-0 top-0 transition-opacity duration-200 ease-out ${
              isLoadingPreview
                ? "opacity-100"
                : "pointer-events-none opacity-0"
            }`}
            aria-hidden={!isLoadingPreview}
          >
            {skeletonRows}
          </div>

          <div
            className={`absolute inset-x-0 top-0 transition-opacity duration-200 ease-out ${
              isLoadingPreview
                ? "pointer-events-none opacity-0"
                : "opacity-100"
            }`}
            aria-hidden={isLoadingPreview}
          >
            {previewContent}
          </div>
        </div>
      </div>

      {previewForApp &&
        previewForApp.modelSource &&
        !previewForApp.modelRecognized && (
        <p className="ui-text-meta text-content-muted text-center mt-5 text-balance">
          {t({
            id: "import.model.unrecognized",
            message:
              "We don't recognize this app's model — you'll pick one on the next step.",
          })}
        </p>
      )}

      {applyMutation.isError && (
        <p className="ui-text-meta ui-color-error-strong text-center mt-5">
          {t({ id: "import.apply.failed", message: "Import failed. Try again or skip." })}
        </p>
      )}

      <div className="mt-9 flex flex-col items-center gap-4">
        <button
          onClick={() => applyMutation.mutate()}
          disabled={applyMutation.isPending || !hasItems || selectedCount === 0}
          className="flex min-w-[180px] items-center justify-center gap-2 rounded-xl bg-content-primary px-6 py-3 ui-text-body-lg font-mono font-semibold text-surface-secondary hover:bg-white transition-colors tracking-tight disabled:opacity-40 disabled:hover:bg-content-primary"
        >
          {applyMutation.isPending ? (
            <>
              <Loader2 size={15} className="animate-spin" />
              {t({ id: "import.importing", message: "Importing..." })}
            </>
          ) : (
            t({ id: "import.cta", message: "Import" })
          )}
        </button>
        <button
          onClick={onNext}
          disabled={applyMutation.isPending}
          className="ui-text-label font-medium text-content-muted hover:text-content-secondary transition-colors disabled:opacity-50"
        >
          {t({ id: "import.skip", message: "Skip for now" })}
        </button>
      </div>
    </motion.div>
  );
}
