import { useLingui } from "@lingui/react/macro";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { motion } from "framer-motion";
import {
  ArrowUpRight,
  Books,
  CardsThree,
  CircleNotch,
  Command,
  Devices,
  Export,
  HardDrives,
  Microphone,
  PenNib,
  Record,
  TerminalWindow,
  TextAa,
  UsersThree,
  WifiSlash,
} from "@phosphor-icons/react";
import type { LicenseState } from "../../license/api";
import { detectAppPlatform } from "../../../platform/service";
import { getDefaultShortcuts } from "../platform";
import { shortcutDisplayParts } from "../../../shared/lib/shortcuts";
import {
  Chip,
  PRIMARY_BUTTON_CLASS,
  SECONDARY_BUTTON_CLASS,
  OnboardingStep,
  ShortcutKeys,
  Tile,
  type StepMotionProps,
} from "./shared";

const PLATFORM = detectAppPlatform();

interface LicenseStepProps {
  stepMotionProps: StepMotionProps;
  licenseState: LicenseState | null;
  opening: boolean;
  openError: string | null;
  activating: boolean;
  activationError: string | null;
  onOpenCheckout: () => void;
  onActivate: (key: string) => void;
  onNext: () => void;
}

export function LicenseStep({
  stepMotionProps,
  licenseState,
  opening,
  openError,
  activating,
  activationError,
  onOpenCheckout,
  onActivate,
  onNext,
}: LicenseStepProps) {
  const { t } = useLingui();
  const [enteringKey, setEnteringKey] = useState(false);
  const status = licenseState?.status;
  const isActive = status === "active";
  const isTrial = status === "trial";

  const title = isActive
    ? t({
        id: "onboarding.license_step.title_active",
        message: "Everything is unlocked.",
      })
    : isTrial
      ? t({
          id: "onboarding.license_step.title_trial",
          message: "Everything is yours for 14 days.",
        })
      : t({
          id: "onboarding.license_step.title_free",
          message: "Get everything with a license.",
        });

  const line = isActive
    ? t({
        id: "onboarding.license_step.line_active",
        message: "Thanks for supporting Glimpse!",
      })
    : t({
        id: "onboarding.license_step.line_free",
        message: "Dictation stays free forever.",
      });

  return (
    <OnboardingStep
      stepKey="license"
      motionProps={stepMotionProps}
      widthClass="max-w-[840px]"
      align="center"
    >
      <div className="grid w-full grid-cols-[1fr_430px] items-center gap-10 text-left">
        <div>
          <h2 className="font-satoshi ui-text-display tracking-tight text-content-primary text-balance">
            {title}
          </h2>
          <p className="mt-3 ui-text-body-lg text-content-muted">{line}</p>

          <div className="mt-10 flex w-[260px] flex-col gap-2.5">
            {isActive ? (
              <button
                type="button"
                onClick={onNext}
                className={`${PRIMARY_BUTTON_CLASS} w-full`}
              >
                {t({
                  id: "onboarding.license_step.continue",
                  message: "Continue",
                })}
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={onOpenCheckout}
                  disabled={opening}
                  className="flex w-full items-center justify-between rounded-lg bg-cloud px-5 py-2.5 ui-text-body-lg font-semibold text-surface-secondary shadow-sm transition-[filter] hover:brightness-105 disabled:opacity-60"
                >
                  <span>
                    {t({
                      id: "onboarding.license_step.buy",
                      message: "Buy License",
                    })}
                  </span>
                  <span className="opacity-80">
                    {opening ? (
                      <CircleNotch size={14} className="animate-spin" />
                    ) : (
                      <ArrowUpRight size={14} />
                    )}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={onNext}
                  className={SECONDARY_BUTTON_CLASS}
                >
                  {isTrial
                    ? t({
                        id: "onboarding.license_step.continue_trial",
                        message: "Continue Free Trial",
                      })
                    : t({
                        id: "onboarding.license_step.continue",
                        message: "Continue",
                      })}
                </button>
                {enteringKey ? (
                  <KeyField
                    activating={activating}
                    onActivate={onActivate}
                    onCancel={() => setEnteringKey(false)}
                  />
                ) : (
                  <div className="flex min-h-9 flex-wrap items-center justify-between gap-x-4 gap-y-1 ui-text-body-sm">
                    <button
                      type="button"
                      onClick={() => setEnteringKey(true)}
                      className="whitespace-nowrap text-content-secondary transition-colors hover:text-content-primary"
                    >
                      {t({
                        id: "onboarding.license_step.have_license",
                        message: "Already have a license?",
                      })}
                    </button>
                  </div>
                )}
              </>
            )}
            <p className="min-h-5 ui-text-meta text-error text-pretty">
              {activating ? null : (activationError ?? openError)}
            </p>
          </div>
        </div>

        <FeatureMarquee />
      </div>
    </OnboardingStep>
  );
}

function FeatureMarquee() {
  const { t } = useLingui();
  const shortcut = shortcutDisplayParts(getDefaultShortcuts(PLATFORM).smart);
  const freeTag = t({
    id: "onboarding.license_step.tag_free",
    message: "Free",
  });

  const left: ReactNode[] = [
    <Tile
      key="cleanup"
      icon={PenNib}
      title={t({
        id: "onboarding.license_step.tile_cleanup",
        message: "AI cleanup",
      })}
    >
      <p className="ui-text-body-sm text-content-disabled line-through">
        {t({
          id: "onboarding.license_step.tile_cleanup_before",
          message: "um so yeah send it tmrw",
        })}
      </p>
      <p className="mt-1 ui-text-body-sm-strong text-content-primary">
        {t({
          id: "onboarding.license_step.tile_cleanup_after",
          message: "Send it tomorrow.",
        })}
      </p>
    </Tile>,
    <Tile
      key="recording"
      icon={Record}
      title={t({
        id: "onboarding.license_step.tile_recording",
        message: "Record meetings",
      })}
    >
      <TrackLine
        label={t({
          id: "onboarding.license_step.tile_recording_you",
          message: "You",
        })}
        level={0.7}
      />
      <TrackLine
        label={t({
          id: "onboarding.license_step.tile_recording_others",
          message: "Others",
        })}
        level={0.45}
      />
    </Tile>,
    <Tile
      key="files"
      icon={Books}
      title={t({
        id: "onboarding.license_step.tile_files",
        message: "Transcribe files",
      })}
    >
      <div className="flex items-center justify-between ui-text-body-sm">
        <span className="font-mono text-content-secondary">interview.m4a</span>
        <span className="text-content-muted">
          {t({
            id: "onboarding.license_step.tile_files_duration",
            message: "42 min",
          })}
        </span>
      </div>
    </Tile>,
    <Tile
      key="raycast"
      icon={Command}
      title={t({
        id: "onboarding.license_step.tile_raycast",
        message: "Raycast",
      })}
    >
      <p className="ui-text-body-sm text-content-muted">
        {t({
          id: "onboarding.license_step.tile_raycast_body",
          message: "Search and paste past dictations.",
        })}
      </p>
    </Tile>,
    <Tile
      key="anywhere"
      icon={Microphone}
      tag={freeTag}
      title={t({
        id: "onboarding.license_step.tile_anywhere",
        message: "Dictate in any app",
      })}
    >
      <ShortcutKeys parts={shortcut} size="sm" />
    </Tile>,
    <Tile
      key="api"
      icon={HardDrives}
      title={t({
        id: "onboarding.license_step.tile_api",
        message: "API server",
      })}
    >
      <p className="font-mono ui-text-meta text-content-secondary">
        /v1/audio/transcriptions
      </p>
    </Tile>,
    <Tile
      key="devices"
      icon={Devices}
      title={t({
        id: "onboarding.license_step.tile_devices",
        message: "One license, 5 devices",
      })}
    >
      <p className="ui-text-body-sm text-content-muted">
        {t({
          id: "onboarding.license_step.tile_devices_body",
          message: "Mac and Windows",
        })}
      </p>
    </Tile>,
  ];

  const right: ReactNode[] = [
    <Tile
      key="edit"
      icon={TextAa}
      title={t({
        id: "onboarding.license_step.tile_edit",
        message: "Edit with your voice",
      })}
    >
      <p className="ui-text-body-sm text-content-primary">
        <span className="rounded bg-cloud-20 px-0.5">
          {t({
            id: "onboarding.license_step.tile_edit_selection",
            message: "hey can u send the file",
          })}
        </span>
      </p>
      <p className="mt-1.5 ui-text-body-sm text-content-muted">
        {t({
          id: "onboarding.license_step.tile_edit_command",
          message: "“Make this more formal”",
        })}
      </p>
    </Tile>,
    <Tile
      key="modes"
      icon={CardsThree}
      title={t({
        id: "onboarding.license_step.tile_modes",
        message: "A mode for every app",
      })}
    >
      <ModeLine
        name={t({
          id: "onboarding.license_step.tile_modes_casual",
          message: "Casual",
        })}
        apps="Slack, Messages"
      />
      <ModeLine
        name={t({
          id: "onboarding.license_step.tile_modes_formal",
          message: "Formal",
        })}
        apps="Mail, gmail.com"
      />
    </Tile>,
    <Tile
      key="speakers"
      icon={UsersThree}
      title={t({
        id: "onboarding.license_step.tile_speakers",
        message: "Know who said what",
      })}
    >
      <ModeLine
        name={t({
          id: "onboarding.license_step.tile_speakers_one",
          message: "Speaker 1",
        })}
        apps="0:12"
      />
      <ModeLine
        name={t({
          id: "onboarding.license_step.tile_speakers_two",
          message: "Speaker 2",
        })}
        apps="0:31"
      />
    </Tile>,
    <Tile
      key="cli"
      icon={TerminalWindow}
      title={t({
        id: "onboarding.license_step.tile_cli",
        message: "Command line",
      })}
    >
      <p className="font-mono ui-text-meta text-content-secondary">
        glimpse transcribe memo.m4a
      </p>
    </Tile>,
    <Tile
      key="export"
      icon={Export}
      title={t({
        id: "onboarding.license_step.tile_export",
        message: "Export transcripts",
      })}
    >
      <div className="flex flex-wrap gap-1.5">
        <Chip>.txt</Chip>
        <Chip>.md</Chip>
        <Chip>.srt</Chip>
        <Chip>.vtt</Chip>
      </div>
    </Tile>,
    <Tile
      key="offline"
      icon={WifiSlash}
      tag={freeTag}
      title={t({
        id: "onboarding.license_step.tile_offline",
        message: "Works offline",
      })}
    >
      <p className="ui-text-body-sm text-content-muted">
        {t({
          id: "onboarding.license_step.tile_offline_body",
          message: "Speech stays on this computer.",
        })}
      </p>
    </Tile>,
  ];

  return (
    <div
      aria-hidden="true"
      className="relative flex h-[540px] gap-3 overflow-hidden"
      style={{
        maskImage:
          "linear-gradient(to bottom, transparent, black 14%, black 86%, transparent)",
      }}
    >
      <MarqueeColumn items={left} duration={56} />
      <MarqueeColumn items={right} duration={66} reverse />
    </div>
  );
}

function TrackLine({ label, level }: { label: string; level: number }) {
  return (
    <div className="flex items-center gap-3 py-0.5 ui-text-body-sm">
      <span className="w-12 shrink-0 text-content-primary">{label}</span>
      <span className="h-1 flex-1 rounded-full bg-surface-secondary">
        <span
          className="block h-1 rounded-full bg-content-muted"
          style={{ width: `${level * 100}%` }}
        />
      </span>
    </div>
  );
}

function MarqueeColumn({
  items,
  duration,
  reverse = false,
}: {
  items: ReactNode[];
  duration: number;
  reverse?: boolean;
}) {
  return (
    <div className="min-w-0 flex-1">
      <motion.div
        className="flex flex-col gap-3"
        animate={{ y: reverse ? ["-50%", "0%"] : ["0%", "-50%"] }}
        transition={{ duration, ease: "linear", repeat: Infinity }}
      >
        {[0, 1].map((copy) =>
          items.map((item, index) => (
            <div key={`${copy}-${index}`}>{item}</div>
          )),
        )}
      </motion.div>
    </div>
  );
}

function ModeLine({ name, apps }: { name: string; apps: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-0.5 ui-text-body-sm">
      <span className="shrink-0 whitespace-nowrap text-content-primary">
        {name}
      </span>
      <span className="text-right text-content-muted">{apps}</span>
    </div>
  );
}

function KeyField({
  activating,
  onActivate,
  onCancel,
}: {
  activating: boolean;
  onActivate: (key: string) => void;
  onCancel: () => void;
}) {
  const { t } = useLingui();
  const [licenseKey, setLicenseKey] = useState("");

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onCancel]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const key = licenseKey.trim();
    if (key) onActivate(key);
  };

  return (
    <form onSubmit={submit} className="flex h-9 items-center gap-2">
      <input
        autoFocus
        value={licenseKey}
        onChange={(event) => setLicenseKey(event.target.value)}
        placeholder="GLIMPSE_…"
        aria-label={t({
          id: "onboarding.license.input_aria",
          message: "License key",
        })}
        className="h-9 min-w-0 flex-1 rounded-lg border border-border-secondary bg-surface-overlay px-3 font-mono ui-text-body-sm text-content-primary placeholder:text-content-disabled outline-none focus:border-content-muted"
      />
      <button
        type="submit"
        disabled={activating || licenseKey.trim().length === 0}
        className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-content-primary px-3 ui-text-body-sm-strong text-surface-secondary transition-opacity hover:opacity-90 disabled:opacity-40"
      >
        {activating ? <CircleNotch size={12} className="animate-spin" /> : null}
        {t({ id: "onboarding.license.activate", message: "Activate" })}
      </button>
    </form>
  );
}
