import { useLingui } from "@lingui/react/macro";
import { motion } from "framer-motion";
import { type ReactNode } from "react";
import { SpinnerGap as Loader2, PencilSimple } from "@phosphor-icons/react";
import { shortcutDisplayParts } from "../../../shared/lib/shortcuts";
import { useInputDevices } from "../../settings/queries";
import { Dropdown } from "../../../shared/ui/Dropdown";
import {
  OnboardingHeader,
  OnboardingStep,
  PRIMARY_BUTTON_CLASS,
  ShortcutKeys,
  useSetupShortcutCapture,
  type StepMotionProps,
} from "./shared";

interface ReadyStepProps {
  stepMotionProps: StepMotionProps;
  smartShortcut: string;
  onSetShortcut: (shortcut: string) => void;
  speechModelError: string | null;
  onRetrySpeechModel: () => void;
  microphoneDevice: string | null;
  onSetMicrophoneDevice: (device: string | null) => void;
  autoLaunch: boolean;
  onSetAutoLaunch: (value: boolean) => void;
  isCompleting: boolean;
  completionError: string | null;
  onComplete: () => void;
}

export function ReadyStep({
  stepMotionProps,
  smartShortcut,
  onSetShortcut,
  speechModelError,
  onRetrySpeechModel,
  microphoneDevice,
  onSetMicrophoneDevice,
  autoLaunch,
  onSetAutoLaunch,
  isCompleting,
  completionError,
  onComplete,
}: ReadyStepProps) {
  const { t } = useLingui();
  const { capturing, preview, startCapture, stopCapture } =
    useSetupShortcutCapture(onSetShortcut);
  const inputDevices = useInputDevices().data ?? [];
  const systemDefaultLabel = t({
    id: "onboarding.done.recap.microphone_default",
    message: "System default",
  });

  return (
    <OnboardingStep
      stepKey="done"
      motionProps={stepMotionProps}
      footer={
        <>
          <button
            // One button per action, so a double click on Retry can't also
            // press Start dictating.
            key={speechModelError ? "retry" : "start"}
            type="button"
            onClick={speechModelError ? onRetrySpeechModel : onComplete}
            disabled={isCompleting}
            aria-busy={isCompleting}
            className={PRIMARY_BUTTON_CLASS}
          >
            {isCompleting ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                {t({ id: "onboarding.done.saving", message: "Saving..." })}
              </>
            ) : speechModelError ? (
              t({
                id: "onboarding.speech_model_retry",
                message: "Retry download",
              })
            ) : (
              t({ id: "onboarding.done.cta", message: "Start dictating" })
            )}
          </button>
          <div className="flex min-h-5 items-center justify-center">
            {speechModelError ? (
              <button
                type="button"
                onClick={onComplete}
                disabled={isCompleting}
                className="ui-text-body-sm text-content-muted transition-colors hover:text-content-primary disabled:pointer-events-none"
              >
                {t({ id: "onboarding.first_dictation.later", message: "Skip" })}
              </button>
            ) : completionError ? (
              <p role="status" className="ui-text-meta text-error">
                {completionError}
              </p>
            ) : null}
          </div>
        </>
      }
    >
      <OnboardingHeader
        title={
          speechModelError
            ? t({
                id: "onboarding.downloads.failed",
                message: "Download failed",
              })
            : t({ id: "onboarding.done.title", message: "You're set" })
        }
        subtitle={
          speechModelError ? (
            <span role="status">{completionError ?? speechModelError}</span>
          ) : (
            t({
              id: "onboarding.done.subtitle.v2",
              message: "You can change these later in Settings.",
            })
          )
        }
      />

      <div className="w-full divide-y divide-border-secondary border-y border-border-secondary text-left">
        <Row
          label={t({
            id: "onboarding.done.recap.shortcut.v2",
            message: "Shortcut",
          })}
        >
          <button
            type="button"
            onClick={() => {
              if (capturing) {
                void stopCapture();
                return;
              }
              startCapture();
            }}
            aria-pressed={capturing}
            aria-label={
              capturing
                ? t({
                    id: "onboarding.first_dictation.cancel_shortcut_aria",
                    message: "Cancel shortcut change",
                  })
                : t({
                    id: "onboarding.first_dictation.edit_shortcut_aria",
                    message: "Change shortcut",
                  })
            }
            className="group flex min-w-0 items-center justify-end gap-2 rounded-md py-0.5"
          >
            <ShortcutKeys
              parts={shortcutDisplayParts(preview || smartShortcut)}
              highlighted={capturing}
              waiting={capturing && !preview}
              size="sm"
            />
            <PencilSimple
              size={13}
              className={`shrink-0 transition-colors ${
                capturing
                  ? "text-local"
                  : "text-content-disabled group-hover:text-content-secondary"
              }`}
            />
          </button>
        </Row>

        <Row
          label={t({
            id: "onboarding.done.recap.microphone",
            message: "Microphone",
          })}
        >
          <Dropdown
            value={microphoneDevice ?? ""}
            ariaLabel={t({
              id: "onboarding.done.recap.microphone",
              message: "Microphone",
            })}
            onChange={(value) => onSetMicrophoneDevice(value || null)}
            options={[
              { value: "", label: systemDefaultLabel },
              ...inputDevices.map((device) => ({
                value: device.id,
                label: device.name,
              })),
            ]}
            className="h-7 max-w-[16rem] shrink-0"
            buttonClassName="h-7 !rounded-md !border-0 !bg-transparent px-0 ui-text-body-sm-strong hover:!bg-transparent"
            valueClassName="text-content-primary text-right"
            menuClassName="top-8 !left-auto w-max min-w-full max-w-[20rem]"
            truncate
          />
        </Row>

        <button
          type="button"
          role="switch"
          aria-checked={autoLaunch}
          onClick={() => onSetAutoLaunch(!autoLaunch)}
          className="flex w-full items-center justify-between gap-4 py-3.5 text-left"
        >
          <span>
            <span className="block ui-text-body-sm-strong text-content-primary">
              {t({
                id: "onboarding.done.auto_launch",
                message: "Open at login",
              })}
            </span>
            <span className="mt-0.5 block ui-text-meta text-content-muted">
              {t({
                id: "onboarding.done.auto_launch.body",
                message: "Start Glimpse when you log in.",
              })}
            </span>
          </span>
          <span
            className={`relative h-6 w-10 shrink-0 rounded-full transition-colors ${
              autoLaunch ? "bg-emerald-500" : "bg-surface-hover"
            }`}
          >
            <motion.span
              layout
              transition={{ type: "spring", stiffness: 500, damping: 32 }}
              className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm ring-1 ring-black/10 ${
                autoLaunch ? "right-0.5" : "left-0.5"
              }`}
            />
          </span>
        </button>
      </div>
    </OnboardingStep>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-3.5">
      <span className="shrink-0 ui-text-section-label-sm ui-color-muted">
        {label}
      </span>
      {children}
    </div>
  );
}
