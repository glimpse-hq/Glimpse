import { invoke } from "@tauri-apps/api/core";
import { useLingui } from "@lingui/react/macro";
import { motion, type Variants } from "framer-motion";
import { HelpCircle, Loader2, RotateCcw, Terminal } from "lucide-react";
import ActionCardButton from "../../../../shared/ui/ActionCardButton";
import { UpdateChecker } from "../../../updates/components/UpdateChecker";
import type { AppInfo, CliInstallStatus } from "../../../../types";

type AboutTabProps = {
  variants: Variants;
  appInfo: AppInfo | null;
  formatBytes: (bytes: number) => string;
  cliInstallStatus: CliInstallStatus | null;
  cliInstallBusy: boolean;
  onInstallCli: () => void;
  onRemoveCli: () => void;
  onOpenDataDir: () => void;
  onOpenFAQ: () => void;
};

const AboutTab = ({
  variants,
  appInfo,
  formatBytes,
  cliInstallStatus,
  cliInstallBusy,
  onInstallCli,
  onRemoveCli,
  onOpenDataDir,
  onOpenFAQ,
}: AboutTabProps) => {
  const { t } = useLingui();

  const cliUnavailable = cliInstallStatus?.sourceAvailable === false;
  const cliInstalled = cliInstallStatus?.installed ?? false;
  const cliInstallPath = cliInstallStatus?.installPath ?? "~/.local/bin/glimpse";
  const cliDescription = cliUnavailable
    ? "CLI binary unavailable in this build"
    : cliInstalled
      ? `Installed at ${cliInstallPath}`
      : cliInstallStatus && !cliInstallStatus.pathInShell
        ? `Installs ${cliInstallStatus.command} to ${cliInstallPath}, which is not on your shell PATH`
        : `Optional terminal access via ${cliInstallStatus?.command ?? "glimpse"}`;

  const recordingsBytes = appInfo?.storage_breakdown?.recordings_bytes ?? 0;
  const libraryBytes = appInfo?.storage_breakdown?.library_bytes ?? 0;
  const databasesBytes = appInfo?.storage_breakdown?.databases_bytes ?? 0;
  const modelsBytes = appInfo?.storage_breakdown?.models_bytes ?? 0;
  const totalBytes =
    appInfo?.storage_breakdown?.total_bytes ?? appInfo?.data_dir_size_bytes ?? 0;

  const handleResetOnboarding = async () => {
    try {
      await invoke("reset_onboarding");
      window.location.reload();
    } catch (err) {
      console.error("Failed to restart onboarding:", err);
    }
  };

  return (
    <motion.div
      key="about"
      variants={variants}
      initial="hidden"
      animate="visible"
      exit="exit"
      className="space-y-6"
    >
      <section className="space-y-2">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="ui-text-section-label-sm ui-color-muted">
            {t({
              id: "settings.about.storage",
              message: "Storage",
            })}
          </h2>
          <span className="ui-text-micro ui-color-disabled font-mono tabular-nums">
            {t({
              id: "settings.about.version_label",
              message: "Glimpse",
            })}{" "}
            {appInfo?.version ?? "-"}
          </span>
        </div>

        <div className="rounded-lg bg-surface-surface px-3 py-2">
          <div className="flex items-baseline justify-between gap-4">
            <span className="ui-text-label-strong ui-color-primary">
              {t({
                id: "settings.about.storage_used",
                message: "Storage Used",
              })}
            </span>
            <span className="ui-text-label-strong ui-color-primary font-mono tabular-nums shrink-0">
              {formatBytes(totalBytes)}
            </span>
          </div>

          {totalBytes > 0 && (
            <p className="ui-text-meta ui-color-disabled mt-0.5">
              {formatBytes(recordingsBytes)} rec · {formatBytes(libraryBytes)} lib ·{" "}
              {formatBytes(databasesBytes)} db · {formatBytes(modelsBytes)} models
            </p>
          )}

          <button
            type="button"
            onClick={onOpenDataDir}
            disabled={!appInfo?.data_dir_path}
            title={appInfo?.data_dir_path}
            className="mt-1.5 block w-full min-w-0 truncate text-left ui-text-meta font-mono ui-color-muted transition-colors hover:ui-color-primary disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span className="border-b border-dotted border-content-disabled/70 pb-px">
              {appInfo?.data_dir_path ?? "-"}
            </span>
          </button>
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="ui-text-section-label-sm ui-color-muted">
          {t({
            id: "settings.about.updates",
            message: "Updates",
          })}
        </h2>
        <UpdateChecker />
      </section>

      <section className="space-y-2">
        <h2 className="ui-text-section-label-sm ui-color-muted">
          {t({
            id: "settings.about.help_and_setup",
            message: "Help & Setup",
          })}
        </h2>

        <div className="grid grid-cols-2 gap-3">
          <ActionCardButton
            onClick={onOpenFAQ}
            title={t({
              id: "settings.about.faq_help",
              message: "FAQ & Help",
            })}
            description={t({
              id: "settings.about.faq_help_description",
              message: "common questions",
            })}
            icon={<HelpCircle size={14} strokeWidth={2} />}
            accentPreset="cloud"
          />

          <ActionCardButton
            onClick={handleResetOnboarding}
            title={t({
              id: "settings.about.restart_onboarding",
              message: "Restart Onboarding",
            })}
            description={t({
              id: "settings.about.restart_onboarding_description",
              message: "re-run setup wizard",
            })}
            icon={<RotateCcw size={14} strokeWidth={2} />}
            accentPreset="accent"
          />
        </div>

        <div className="rounded-lg border border-border-primary bg-surface-surface px-3 py-2.5">
          <div className="flex items-center gap-2.5">
            <span className="flex size-5 shrink-0 items-center justify-center ui-color-primary">
              <Terminal size={14} strokeWidth={2} aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <span className="ui-text-label-strong ui-color-primary block">
                {t({
                  id: "settings.about.command_line",
                  message: "Command line",
                })}
              </span>
              <span className="ui-text-micro ui-color-disabled block truncate" title={cliDescription}>
                {cliDescription}
              </span>
            </div>
            <button
              type="button"
              onClick={cliInstalled ? onRemoveCli : onInstallCli}
              disabled={cliInstallBusy || (!cliInstalled && cliUnavailable)}
              className="inline-flex h-7 min-w-[5.25rem] shrink-0 items-center justify-center gap-1 overflow-hidden rounded-md border border-border-secondary bg-surface-elevated px-2 ui-text-meta font-medium ui-color-muted outline-hidden hover:ui-color-primary hover:border-border-hover transition-colors disabled:pointer-events-none disabled:opacity-60"
            >
              {cliInstallBusy && <Loader2 size={10} className="animate-spin" />}
              <span>
                {cliInstalled
                  ? t({
                      id: "settings.about.uninstall_cli",
                      message: "Uninstall",
                    })
                  : t({
                      id: "settings.about.install_cli",
                      message: "Install CLI",
                    })}
              </span>
            </button>
          </div>
        </div>
      </section>
    </motion.div>
  );
};

export default AboutTab;
