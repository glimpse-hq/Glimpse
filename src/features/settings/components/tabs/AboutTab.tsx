import { invoke } from "@tauri-apps/api/core";
import { motion, type Variants } from "framer-motion";
import { UpdateChecker } from "../../../updates/components/UpdateChecker";
import ActionCardButton from "../../../../shared/ui/ActionCardButton";
import type { AppInfo } from "../../../../types";

type AboutTabProps = {
  variants: Variants;
  appInfo: AppInfo | null;
  formatBytes: (bytes: number) => string;
  onOpenDataDir: () => void;
  onOpenFAQ: () => void;
};

const AboutTab = ({
  variants,
  appInfo,
  formatBytes,
  onOpenDataDir,
  onOpenFAQ,
}: AboutTabProps) => {
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
          <h2 className="ui-text-section-label-sm ui-color-muted">
            Updates
          </h2>
          <UpdateChecker />
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
