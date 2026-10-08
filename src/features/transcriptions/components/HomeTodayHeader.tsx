import { useLingui } from "@lingui/react/macro";
import { useMemo } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { invoke } from "@tauri-apps/api/core";
import { formatShortcutForDisplay } from "../../../shared/lib/shortcuts";
import {
  useAccessibilityPermission,
  useSettings,
} from "../../settings/queries";
import { labelForTodayStatSlide } from "../homeHeaderStats";
import {
  getHomeGreetingVariant,
  homeGreetingKey,
  labelForHomeGreeting,
  useTimeOfDayPeriodTick,
} from "../homeGreeting";
import { getActiveTodayStatSlide } from "../todayStats";
import type { StoredSettings, TodayDictationStats } from "../../../types";
import AskPrompt from "../../asks/components/AskPrompt";

const fadeTransition = { duration: 0.22, ease: "easeOut" as const };

type DictationShortcut = { shortcut: string; hold: boolean };

// The shortcut a reminder should name: Smart first, then Hold, then Toggle.
const dictationShortcut = (
  settings: StoredSettings,
): DictationShortcut | null => {
  const modes = [
    [settings.smart_enabled, settings.shortcut_bindings.smart, true],
    [settings.hold_enabled, settings.shortcut_bindings.hold, true],
    [settings.toggle_enabled, settings.shortcut_bindings.toggle, false],
  ] as const;
  for (const [enabled, bindings, hold] of modes) {
    const shortcut = enabled ? bindings[0]?.shortcut : undefined;
    if (shortcut) return { shortcut, hold };
  }
  return null;
};

type HomeTodayHeaderProps = {
  transcriptionsFetched: boolean;
  stats: TodayDictationStats;
  active: boolean;
};

export default function HomeTodayHeader({
  transcriptionsFetched,
  stats,
  active,
}: HomeTodayHeaderProps) {
  const { t } = useLingui();
  const periodTick = useTimeOfDayPeriodTick(active);

  const now = new Date();

  const greetingVariant = useMemo(
    () => getHomeGreetingVariant(now),
    [periodTick, now.getFullYear(), now.getMonth(), now.getDate()],
  );
  const statSlide = useMemo(
    () => getActiveTodayStatSlide(stats, now),
    [periodTick, stats, now.getFullYear(), now.getMonth(), now.getDate()],
  );

  const greetingText = greetingVariant
    ? labelForHomeGreeting(greetingVariant, t)
    : "";
  const greetingKey = greetingVariant
    ? homeGreetingKey(greetingVariant, now)
    : "empty";
  const statText = statSlide ? labelForTodayStatSlide(statSlide, stats, t) : "";

  const { data: shortcut } = useSettings(dictationShortcut);
  const { data: accessibilityGranted } = useAccessibilityPermission(active);
  const shortcutLabel = shortcut
    ? formatShortcutForDisplay(shortcut.shortcut)
    : "";
  // Replaces the empty "0 dictations today" line, so it never adds a row.
  const reminderText =
    stats.count > 0 || !shortcut
      ? ""
      : shortcut.hold
        ? t({
            id: "home.today.reminder.hold",
            message: `Hold ${shortcutLabel} and speak to dictate in any app.`,
          })
        : t({
            id: "home.today.reminder.toggle",
            message: `Press ${shortcutLabel} to dictate in any app, then press it again to stop.`,
          });

  return (
    <header className="mb-3 shrink-0">
      <AnimatePresence mode="wait" initial={false}>
        <motion.h1
          key={greetingKey}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={fadeTransition}
          className="font-satoshi ui-text-display font-normal ui-color-primary tracking-tight"
        >
          {greetingText}
        </motion.h1>
      </AnimatePresence>

      {accessibilityGranted === false ? (
        <p className="mt-2 ui-text-body-sm ui-color-muted">
          {t({
            id: "home.today.accessibility_missing",
            message: "Your shortcut needs Accessibility access to work.",
          })}{" "}
          <button
            type="button"
            onClick={() => {
              void invoke("open_accessibility_settings").catch(() => {});
            }}
            className="ui-text-body-sm-strong ui-color-cloud underline-offset-4 hover:underline"
          >
            {t({
              id: "home.today.accessibility_open",
              message: "Open System Settings",
            })}
          </button>
        </p>
      ) : transcriptionsFetched && (reminderText || statText) ? (
        <p
          className={`mt-2 ui-text-body-sm ${reminderText ? "ui-color-muted" : "ui-color-disabled"}`}
        >
          {reminderText || statText}
        </p>
      ) : null}

      <AskPrompt active={active} />
    </header>
  );
}
