import { motion, type Variants } from "framer-motion";
import { CircleNotch, VideoCamera } from "@phosphor-icons/react";
import { useLingui } from "@lingui/react/macro";
import SectionLabel from "../../../../shared/ui/SectionLabel";
import SettingCard from "../../../../shared/ui/SettingCard";
import SettingRow, { ToggleRow } from "../../../../shared/ui/SettingRow";
import ToggleSwitch from "../../../../shared/ui/ToggleSwitch";
import type { MeetingDetectionApp } from "../../../../types";

type MeetingsTabProps = {
  variants: Variants;
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  selectedAppIds: string[];
  onSelectedAppIdsChange: (ids: string[]) => void;
  installedApps: MeetingDetectionApp[];
  loading: boolean;
};

const MeetingsTab = ({
  variants,
  enabled,
  onEnabledChange,
  selectedAppIds,
  onSelectedAppIdsChange,
  installedApps,
  loading,
}: MeetingsTabProps) => {
  const { t } = useLingui();

  const toggleApp = (appId: string) => {
    onSelectedAppIdsChange(
      selectedAppIds.includes(appId)
        ? selectedAppIds.filter((id) => id !== appId)
        : [...selectedAppIds, appId],
    );
  };

  return (
    <motion.div
      key="meetings"
      variants={variants}
      initial="hidden"
      animate="visible"
      exit="exit"
      className="space-y-6"
    >
      <div className="space-y-2">
        <SectionLabel>
          {t({
            id: "settings.meetings.detection.section",
            message: "Automatic detection",
          })}
        </SectionLabel>
        <SettingCard>
          <ToggleRow
            title={t({
              id: "settings.meetings.detection.title",
              message: "Detect online meetings",
            })}
            description={t({
              id: "settings.meetings.detection.description",
              message:
                "Shows a recording prompt when a supported meeting starts.",
            })}
            enabled={enabled}
            onToggle={() => onEnabledChange(!enabled)}
            ariaLabel={t({
              id: "settings.meetings.detection.toggle_aria",
              message: "Toggle automatic meeting detection",
            })}
          />
        </SettingCard>
      </div>

      <div className="space-y-2">
        <SectionLabel>
          {t({
            id: "settings.meetings.apps.section",
            message: "Applications",
          })}
        </SectionLabel>
        <SettingCard className={!enabled ? "opacity-60" : ""}>
          {loading ? (
            <div className="flex min-h-16 items-center justify-center ui-color-muted">
              <CircleNotch
                size={16}
                className="animate-spin"
                aria-hidden="true"
              />
              <span className="sr-only">
                {t({
                  id: "settings.meetings.apps.loading",
                  message: "Looking for installed meeting apps",
                })}
              </span>
            </div>
          ) : installedApps.length === 0 ? (
            <p className="px-2 py-3 ui-text-meta ui-color-disabled">
              {t({
                id: "settings.meetings.apps.empty",
                message: "No compatible meeting applications were found.",
              })}
            </p>
          ) : (
            <div className="divide-y divide-border-primary">
              {installedApps.map((app) => {
                const selected = selectedAppIds.includes(app.id);
                return (
                  <SettingRow
                    key={app.id}
                    icon={<VideoCamera size={15} aria-hidden="true" />}
                    title={app.name}
                    description={t({
                      id: "settings.meetings.apps.installed",
                      message: "Installed on this Mac",
                    })}
                    control={
                      <ToggleSwitch
                        enabled={selected}
                        onToggle={() => toggleApp(app.id)}
                        disabled={!enabled}
                        ariaLabel={t({
                          id: "settings.meetings.apps.toggle_aria",
                          message:
                            "Toggle meeting detection for this application",
                        })}
                      />
                    }
                  />
                );
              })}
            </div>
          )}
        </SettingCard>
        <p className="px-1 ui-text-meta ui-color-disabled">
          {t({
            id: "settings.meetings.apps.description",
            message:
              "Only selected applications are monitored. Browser detection requires Accessibility and checks only the active tab; Glimpse does not read meeting content.",
          })}
        </p>
      </div>
    </motion.div>
  );
};

export default MeetingsTab;
