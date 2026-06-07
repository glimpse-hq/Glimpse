import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useLingui } from "@lingui/react/macro";
import { motion, type Variants } from "framer-motion";
import {
  ArrowUpRight,
  Question as HelpCircle,
  Info,
  CircleNotch as Loader2,
  ArrowCounterClockwise as RotateCcw,
  TerminalWindow as Terminal,
} from "@phosphor-icons/react";

const CLI_WIKI_URL = "https://github.com/LegendarySpy/Glimpse/wiki/CLI";
import ActionCardButton from "../../../../shared/ui/ActionCardButton";
import SectionLabel from "../../../../shared/ui/SectionLabel";
import HoldActionCardButton from "../../../../shared/ui/HoldActionCardButton";
import { UpdateChecker } from "../../../updates/components/UpdateChecker";
import type {
  AppInfo,
  CliInstallStatus,
  TranscriptionMode,
} from "../../../../types";

type AboutTabProps = {
  variants: Variants;
  appInfo: AppInfo | null;
  transcriptionMode: TranscriptionMode;
  formatBytes: (bytes: number) => string;
  cliInstallStatus: CliInstallStatus | null;
  cliInstallBusy: boolean;
  licenseGateActive: boolean;
  onInstallCli: () => void;
  onRemoveCli: () => void;
  onOpenDataDir: () => void;
  onOpenFAQ: () => void;
  onOpenWhatsNew: () => void;
};

const AboutTab = ({
  variants,
  appInfo,
  transcriptionMode,
  formatBytes,
  cliInstallStatus,
  cliInstallBusy,
  licenseGateActive,
  onInstallCli,
  onRemoveCli,
  onOpenDataDir,
  onOpenFAQ,
  onOpenWhatsNew,
}: AboutTabProps) => {
  const { t } = useLingui();

  const isCloudMode = transcriptionMode === "cloud";
  const modeLabel = isCloudMode
    ? t({
        id: "settings.about.mode.cloud",
        message: "Cloud",
      })
    : t({
        id: "settings.about.mode.local",
        message: "Local",
      });

  const recordingsBytes = appInfo?.storage_breakdown?.recordings_bytes ?? 0;
  const libraryBytes = appInfo?.storage_breakdown?.library_bytes ?? 0;
  const databasesBytes = appInfo?.storage_breakdown?.databases_bytes ?? 0;
  const modelsBytes = appInfo?.storage_breakdown?.models_bytes ?? 0;
  const totalBytes =
    appInfo?.storage_breakdown?.total_bytes ??
    appInfo?.data_dir_size_bytes ??
    0;
  const cliUnavailable = cliInstallStatus?.sourceAvailable === false;
  const cliInstalled = cliInstallStatus?.installed ?? false;
  const cliInstallLocked = !licenseGateActive && !cliInstalled;
  const cliInstallPath =
    cliInstallStatus?.installPath ?? "~/.local/bin/glimpse";
  const cliInfo = cliUnavailable
    ? t({
        id: "settings.about.cli.unavailable_info",
        message: "This build does not include the command line helper.",
      })
    : cliInstallLocked
      ? t({
          id: "settings.about.cli.locked_info",
          message: "Command line install requires an active license.",
        })
    : cliInstalled
      ? t({
          id: "settings.about.cli.installed_info",
          message: `The glimpse command is installed at ${cliInstallPath}. Use it from Terminal, scripts, or automation tools to call Glimpse without opening the app UI.`,
        })
    : cliInstallStatus && !cliInstallStatus.pathInShell
      ? t({
          id: "settings.about.cli.path_missing_info",
          message: `Installs ${cliInstallStatus.command} to ${cliInstallPath}. That folder is not currently on your shell PATH, so you may need to call it by full path or update your shell profile.`,
        })
      : t({
          id: "settings.about.cli.default_info",
          message: `Installs the ${cliInstallStatus?.command ?? "glimpse"} command for Terminal, scripts, and automation tools. Use it when you want to call Glimpse programmatically without opening the app UI.`,
        });
  const cliSubtitle = cliUnavailable
    ? t({
        id: "settings.about.cli.unavailable_subtitle",
        message: "Not available in this build",
      })
    : cliInstallLocked
      ? t({
          id: "settings.about.cli.locked_subtitle",
          message: "Requires an active license",
        })
    : cliInstalled
      ? t({
          id: "settings.about.cli.installed_subtitle",
          message: `Installed at ${cliInstallPath}`,
        })
      : t({
          id: "settings.about.cli.default_subtitle",
          message: "Use Glimpse from Terminal or scripts",
        });
  const storageRows = [
    {
      label: t({
        id: "settings.about.storage.recordings",
        message: "Recordings",
      }),
      value: recordingsBytes,
    },
    {
      label: t({
        id: "settings.about.storage.library",
        message: "Library",
      }),
      value: libraryBytes,
    },
    {
      label: t({
        id: "settings.about.storage.models",
        message: "Models",
      }),
      value: modelsBytes,
    },
    {
      label: t({
        id: "settings.about.storage.database",
        message: "Database",
      }),
      value: databasesBytes,
    },
    {
      label: t({
        id: "settings.about.storage.total",
        message: "Total",
      }),
      value: totalBytes,
      primary: true,
    },
  ];

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
      className="space-y-5"
    >
      <header>
        <h1 className="ui-text-title-lg font-medium ui-color-primary">
          {t({
            id: "settings.about.version_label",
            message: "Glimpse",
          })}
        </h1>
        <p className="mt-1 ui-text-body-sm ui-color-muted">
          {t({
            id: "settings.about.version",
            message: "Version",
          })}{" "}
          <span className="font-mono tabular-nums">
            {appInfo?.version ?? "-"}
          </span>
          <span aria-hidden="true" className="mx-1.5 ui-color-disabled">
            ·
          </span>
          <span>{modeLabel}</span>
        </p>
      </header>

      <section className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <SectionLabel>
            {t({
              id: "settings.about.updates",
              message: "Updates",
            })}
          </SectionLabel>
          <UpdateChecker onOpenWhatsNew={onOpenWhatsNew} />
        </div>
      </section>

      <section className="space-y-2">
        <SectionLabel>
          {t({
            id: "settings.about.storage",
            message: "Storage",
          })}
        </SectionLabel>

        <div className="rounded-lg bg-surface-surface p-2.5">
          <div className="grid grid-cols-5 gap-3 px-2 py-2">
            {storageRows.map((row) => (
              <div key={row.label} className="min-w-0">
                <p className="ui-text-micro ui-color-disabled">{row.label}</p>
                <p
                  className={`mt-0.5 truncate font-mono tabular-nums ${
                    row.primary
                      ? "ui-text-label-strong ui-color-primary"
                      : "ui-text-meta ui-color-muted"
                  }`}
                >
                  {formatBytes(row.value)}
                </p>
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={onOpenDataDir}
            disabled={!appInfo?.data_dir_path}
            title={appInfo?.data_dir_path}
            className="mt-1 block w-full min-w-0 truncate px-2 py-1 text-left ui-text-meta font-mono ui-color-muted transition-colors hover:ui-color-primary disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span className="border-b border-dotted border-content-disabled/70 pb-px">
              {appInfo?.data_dir_path ?? "-"}
            </span>
          </button>
        </div>
      </section>

      <section className="space-y-2">
        <SectionLabel>
          {t({
            id: "settings.about.setup",
            message: "Setup & help",
          })}
        </SectionLabel>

        <div className="grid grid-cols-2 gap-4">
          <HoldActionCardButton
            onConfirm={() => {
              void handleResetOnboarding();
            }}
            accentPreset="accent"
            title={t({
              id: "settings.about.restart_onboarding",
              message: "Restart Onboarding",
            })}
            description={t({
              id: "settings.about.restart_onboarding_description",
              message: "hold to re-run setup experience",
            })}
            ariaLabel={t({
              id: "settings.about.restart_onboarding_hold_aria",
              message: "Restart Onboarding. Hold to confirm.",
            })}
            icon={<RotateCcw size={14} strokeWidth={2} />}
          />
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
        </div>
      </section>

      <section className="space-y-2">
        <SectionLabel>
          {t({
            id: "settings.about.advanced",
            message: "Advanced",
          })}
        </SectionLabel>

        <div className="grid grid-cols-2 gap-4">
          <div className="rounded-lg bg-surface-surface p-2.5">
            <div className="flex min-h-[52px] gap-2.5 px-1 py-0.5">
              <span className="flex size-5 shrink-0 self-center items-center justify-center ui-color-muted">
                <Terminal size={14} strokeWidth={2} aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2.5">
                  <div className="flex min-w-0 flex-1 items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        void openUrl(CLI_WIKI_URL);
                      }}
                      aria-label={t({
                        id: "settings.about.command_line.open_wiki_aria",
                        message: "Open the command line documentation",
                      })}
                      className="inline-flex min-w-0 items-center gap-1 ui-text-label-strong ui-color-primary transition-colors hover:text-content-secondary outline-none focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-border-hover"
                    >
                      <span className="truncate">
                        {t({
                          id: "settings.about.command_line",
                          message: "Command line",
                        })}
                      </span>
                      <ArrowUpRight
                        size={12}
                        strokeWidth={2}
                        aria-hidden="true"
                        className="shrink-0 ui-color-muted"
                      />
                    </button>
                    <div className="relative group shrink-0">
                      <button
                        type="button"
                        className="flex size-4 items-center justify-center ui-color-disabled transition-colors hover:ui-color-muted focus:ui-color-muted focus:outline-none"
                        aria-label={t({
                          id: "settings.about.command_line.info_aria",
                          message: "More information about command line tools",
                        })}
                      >
                        <Info size={10} aria-hidden="true" />
                      </button>
                      <div className="absolute left-1/2 bottom-full z-20 mb-1 hidden -translate-x-1/2 group-hover:block group-focus-within:block">
                        <div className="w-56 rounded-lg border border-border-secondary bg-surface-overlay px-2.5 py-1.5 ui-text-micro ui-color-secondary shadow-lg leading-tight">
                          {cliInfo}
                        </div>
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={cliInstalled ? onRemoveCli : onInstallCli}
                    disabled={
                      cliInstallBusy ||
                      (!cliInstalled && (cliUnavailable || !licenseGateActive))
                    }
                    className="inline-flex h-6 min-w-[4.75rem] shrink-0 items-center justify-center gap-1 px-1 ui-text-button-sm ui-color-secondary transition-colors hover:text-content-primary disabled:pointer-events-none disabled:opacity-60"
                  >
                    {cliInstallBusy && (
                      <Loader2 size={10} className="animate-spin" />
                    )}
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
                <p className="mt-1 truncate ui-text-meta ui-color-muted">
                  {cliSubtitle}
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>
    </motion.div>
  );
};

export default AboutTab;
