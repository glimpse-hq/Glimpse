import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { AnimatePresence, motion, type Variants } from "framer-motion";
import { Check, ChevronDown } from "lucide-react";
import { UpdateChecker } from "../../../updates/components/UpdateChecker";
import ActionCardButton from "../../../../shared/ui/ActionCardButton";
import type { AppInfo, UpdateChannel } from "../../../../types";

type AboutTabProps = {
  variants: Variants;
  appInfo: AppInfo | null;
  formatBytes: (bytes: number) => string;
  onOpenDataDir: () => void;
  onOpenFAQ: () => void;
  updateChannel: UpdateChannel;
  onUpdateChannelChange: (channel: UpdateChannel) => void;
};

const UPDATE_CHANNEL_OPTIONS: Array<{
  value: UpdateChannel;
  label: string;
  description: string;
}> = [
  {
    value: "stable",
    label: "Stable",
    description: "Recommended for most people",
  },
  {
    value: "prerelease",
    label: "Pre-release",
    description: "Early access to upcoming builds",
  },
];

const AboutTab = ({
  variants,
  appInfo,
  formatBytes,
  onOpenDataDir,
  onOpenFAQ,
  updateChannel,
  onUpdateChannelChange,
}: AboutTabProps) => {
  const [channelMenuOpen, setChannelMenuOpen] = useState(false);
  const channelMenuRef = useRef<HTMLDivElement | null>(null);
  const selectedChannel = UPDATE_CHANNEL_OPTIONS.find(
    (option) => option.value === updateChannel,
  );

  useEffect(() => {
    if (!channelMenuOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (
        channelMenuRef.current &&
        !channelMenuRef.current.contains(event.target as Node)
      ) {
        setChannelMenuOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setChannelMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [channelMenuOpen]);

  return (
    <motion.div
      key="about"
      variants={variants}
      initial="hidden"
      animate="visible"
      exit="exit"
      className="space-y-6"
    >
      <div className="space-y-2">
        <h2 className="ui-text-section-label-sm ui-color-muted">App Info</h2>

        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-lg bg-surface-surface p-2.5">
            <div className="px-2 py-1.5">
              <span className="ui-text-micro ui-color-disabled block">
                Version
              </span>
              <span className="ui-text-label-strong ui-color-primary">
                {appInfo?.version ?? "-"}
              </span>
            </div>
          </div>
          <div className="rounded-lg bg-surface-surface p-2.5">
            <div className="px-2 py-1.5">
              <span className="ui-text-micro ui-color-disabled block">
                Storage Used
              </span>
              <span className="ui-text-label-strong ui-color-primary">
                {appInfo ? formatBytes(appInfo.data_dir_size_bytes) : "-"}
              </span>
            </div>
          </div>
        </div>

        <div className="rounded-lg bg-surface-surface p-2.5">
          <button
            type="button"
            onClick={onOpenDataDir}
            disabled={!appInfo?.data_dir_path}
            className="w-full px-2 py-1.5 text-left disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <span className="ui-text-micro ui-color-disabled block">
              Data Location
            </span>
            <span className="ui-text-label ui-color-muted font-mono truncate block">
              <span className="border-b border-dotted border-content-disabled pb-[1px]">
                {appInfo?.data_dir_path ?? "-"}
              </span>
            </span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <h2 className="ui-text-section-label-sm ui-color-muted">
              Updates
            </h2>
            <div ref={channelMenuRef} className="relative">
              <button
                type="button"
                onClick={() => setChannelMenuOpen((prev) => !prev)}
                aria-haspopup="listbox"
                aria-expanded={channelMenuOpen}
                className="flex items-center gap-1.5 ui-text-meta ui-color-muted hover:text-content-secondary transition-colors"
              >
                <span className="ui-color-primary">
                  {selectedChannel?.label ?? "Stable"}
                </span>
                <ChevronDown
                  size={12}
                  className={`translate-y-[1px] transition-transform duration-150 ${channelMenuOpen ? "rotate-180" : ""}`}
                  aria-hidden="true"
                />
              </button>

              <AnimatePresence>
                {channelMenuOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: -4, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -4, scale: 0.98 }}
                    transition={{ duration: 0.12 }}
                    className="absolute right-0 top-full mt-1 z-[120] w-52 rounded-md border border-border-secondary/80 bg-surface-overlay shadow-lg shadow-black/40 overflow-hidden"
                    role="listbox"
                    aria-label="Update channel"
                  >
                    <div className="px-3 py-1.5 ui-text-uppercase-meta font-semibold ui-color-disabled border-b border-border-secondary/80">
                      Channel
                    </div>
                    {UPDATE_CHANNEL_OPTIONS.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        role="option"
                        aria-selected={updateChannel === option.value}
                        onClick={() => {
                          onUpdateChannelChange(option.value);
                          setChannelMenuOpen(false);
                        }}
                        className={`w-full text-left px-3 py-2 transition-colors ${
                          updateChannel === option.value
                            ? "bg-cloud/10"
                            : "hover:bg-surface-elevated/70"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <p
                              className={`ui-text-body-sm-strong truncate ${
                                updateChannel === option.value
                                  ? "ui-color-cloud"
                                  : "ui-color-secondary"
                              }`}
                            >
                              {option.label}
                            </p>
                            <p className="ui-text-meta ui-color-disabled truncate">
                              {option.description}
                            </p>
                          </div>
                          <span
                            className={`shrink-0 ${updateChannel === option.value ? "ui-color-cloud" : "text-transparent"}`}
                          >
                            <Check size={12} aria-hidden="true" />
                          </span>
                        </div>
                      </button>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
          <UpdateChecker updateChannel={updateChannel} />
        </div>

        <div className="space-y-2">
          <h2 className="ui-text-section-label-sm ui-color-muted">Setup</h2>

          <div className="space-y-3">
            <ActionCardButton
              onClick={async () => {
                try {
                  await invoke("reset_onboarding");
                  window.location.reload();
                } catch (err) {
                  console.error("Failed to restart onboarding:", err);
                }
              }}
              title="Restart Onboarding"
              description="re-run setup wizard"
            />

            <ActionCardButton
              onClick={onOpenFAQ}
              title="FAQ & Help"
              description="common questions"
            />
          </div>
        </div>
      </div>
    </motion.div>
  );
};

export default AboutTab;
