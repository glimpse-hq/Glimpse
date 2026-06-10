import { useLingui } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { motion } from "framer-motion";
import {
  ArrowSquareOut as ExternalLink,
  CaretRight as ChevronRight,
  Check,
  Microphone as Mic,
  SpinnerGap as Loader2,
} from "@phosphor-icons/react";
import { AppleAccessibilityIcon, type StepMotionProps } from "./shared";

interface PermissionsStepProps {
  stepMotionProps: StepMotionProps;
  requiresMicrophone: boolean;
  requiresAccessibility: boolean;
  micPermission: boolean;
  accessibilityPermission: boolean;
  isCheckingMic: boolean;
  isCheckingAccessibility: boolean;
  onRequestMic: () => void;
  onRequestAccessibility: () => void;
  onNext: () => void;
}

export function PermissionsStep({
  stepMotionProps,
  requiresMicrophone,
  requiresAccessibility,
  micPermission,
  accessibilityPermission,
  isCheckingMic,
  isCheckingAccessibility,
  onRequestMic,
  onRequestAccessibility,
  onNext,
}: PermissionsStepProps) {
  const { t } = useLingui();
  const appName = t({
    id: "onboarding.accessibility.app_name",
    message: "Glimpse",
  });
  const allGranted =
    (!requiresMicrophone || micPermission) &&
    (!requiresAccessibility || accessibilityPermission);

  return (
    <motion.div
      key="permissions"
      {...stepMotionProps}
      initial="enter"
      className="flex w-full max-w-md flex-col items-center text-center"
    >
      <h2 className="ui-text-title-lg font-semibold text-content-primary mb-2">
        {t({
          id: "onboarding.permissions.title",
          message: "Permissions",
        })}
      </h2>

      <p className="mb-8 max-w-sm ui-text-body-lg text-content-muted">
        {t({
          id: "onboarding.permissions.subtitle",
          message:
            "Glimpse needs these to record your voice and put text where your cursor is.",
        })}
      </p>

      <div className="w-full divide-y divide-border-secondary">
        {requiresMicrophone && (
          <PermissionRow
            icon={<Mic size={18} />}
            title={t({
              id: "onboarding.microphone.title",
              message: "Microphone Access",
            })}
            body={t({
              id: "onboarding.microphone.subtitle",
              message: "Required to capture your voice for transcription.",
            })}
            granted={micPermission}
            checking={isCheckingMic}
            actionLabel={t({
              id: "onboarding.microphone.grant",
              message: "Grant Access",
            })}
            actionIcon={<Mic size={14} />}
            onRequest={onRequestMic}
          />
        )}

        {requiresAccessibility && (
          <PermissionRow
            icon={<AppleAccessibilityIcon size={18} />}
            title={t({
              id: "onboarding.accessibility.title",
              message: "Accessibility",
            })}
            body={t({
              id: "onboarding.accessibility.subtitle",
              message: "Enables auto-paste into any application.",
            })}
            help={t({
              id: "onboarding.accessibility.instructions",
              message: `Click below to open System Settings, then toggle on ${appName}`,
            })}
            granted={accessibilityPermission}
            checking={isCheckingAccessibility}
            actionLabel={t({
              id: "onboarding.accessibility.enable",
              message: "Enable in Settings",
            })}
            actionIcon={<ExternalLink size={14} />}
            onRequest={onRequestAccessibility}
          />
        )}
      </div>

      <button
        type="button"
        onClick={onNext}
        disabled={!allGranted}
        className="mt-8 inline-flex min-w-[150px] items-center justify-center gap-2 rounded-lg bg-emerald-500 px-5 py-2.5 ui-text-body-lg font-medium ui-color-on-solid transition-colors hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {t({
          id: "onboarding.permissions.continue",
          message: "Continue",
        })}
        <ChevronRight size={15} />
      </button>

      <button
        type="button"
        onClick={onNext}
        className="mt-3 ui-text-body-sm text-content-muted transition-colors hover:text-content-primary"
      >
        {t({
          id: "onboarding.permissions.skip",
          message: "Skip",
        })}
      </button>
    </motion.div>
  );
}

function PermissionRow({
  icon,
  title,
  body,
  help,
  granted,
  checking,
  actionLabel,
  actionIcon,
  onRequest,
}: {
  icon: ReactNode;
  title: string;
  body: string;
  help?: string;
  granted: boolean;
  checking: boolean;
  actionLabel: string;
  actionIcon: ReactNode;
  onRequest: () => void;
}) {
  return (
    <div className="flex items-center gap-4 py-5 text-left">
      <BigCheck granted={granted} checking={checking} />

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-content-muted">{icon}</span>
          <h3 className="ui-text-body-lg-strong text-content-primary">
            {title}
          </h3>
        </div>
        <p className="mt-1 ui-text-body-sm text-content-muted">{body}</p>
        {!granted && help && (
          <p className="mt-1 ui-text-meta text-content-disabled">{help}</p>
        )}
      </div>

      {!granted && (
        <button
          type="button"
          onClick={onRequest}
          disabled={checking}
          className="inline-flex shrink-0 items-center gap-1.5 ui-text-body-sm-strong text-cloud underline-offset-4 transition-colors hover:underline disabled:cursor-not-allowed disabled:opacity-50"
        >
          {actionIcon}
          {actionLabel}
        </button>
      )}
    </div>
  );
}

function BigCheck({
  granted,
  checking,
}: {
  granted: boolean;
  checking: boolean;
}) {
  return (
    <div
      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border transition-colors ${
        granted
          ? "border-emerald-500 bg-emerald-500 text-white"
          : "border-border-secondary"
      }`}
    >
      {checking ? (
        <Loader2 size={15} className="animate-spin text-content-muted" />
      ) : granted ? (
        <motion.span
          initial={{ scale: 0.6, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
        >
          <Check size={18} />
        </motion.span>
      ) : null}
    </div>
  );
}
