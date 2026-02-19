import { invoke } from "@tauri-apps/api/core";
import { motion, type Variants } from "framer-motion";
import { UpdateChecker } from "../UpdateChecker";
import type { AppInfo } from "../../../types";

type AboutTabProps = {
    variants: Variants;
    appInfo: AppInfo | null;
    formatBytes: (bytes: number) => string;
    onOpenDataDir: () => void;
    onOpenFAQ: () => void;
};

const AboutTab = ({ variants, appInfo, formatBytes, onOpenDataDir, onOpenFAQ }: AboutTabProps) => (
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
                <div className="rounded-lg border border-border-primary bg-surface-surface py-2.5 px-3">
                    <span className="ui-text-micro ui-color-disabled block">Version</span>
                    <span className="ui-text-body-sm-strong ui-color-primary">{appInfo?.version ?? "-"}</span>
                </div>
                <div className="rounded-lg border border-border-primary bg-surface-surface py-2.5 px-3">
                    <span className="ui-text-micro ui-color-disabled block">Storage Used</span>
                    <span className="ui-text-body-sm-strong ui-color-primary">{appInfo ? formatBytes(appInfo.data_dir_size_bytes) : "-"}</span>
                </div>
            </div>

            <button
                type="button"
                onClick={onOpenDataDir}
                disabled={!appInfo?.data_dir_path}
                className="w-full rounded-lg border border-border-primary bg-surface-surface py-2 px-3 text-left hover:border-border-secondary disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
                <span className="ui-text-micro ui-color-disabled block">Data Location</span>
                <span className="ui-text-label ui-color-muted font-mono truncate block"><span className="border-b border-dotted border-content-disabled pb-[1px]">{appInfo?.data_dir_path ?? "-"}</span></span>
            </button>
        </div>

        <div className="space-y-2">
            <h2 className="ui-text-section-label-sm ui-color-muted">Updates</h2>
            <UpdateChecker />
        </div>

        <div className="space-y-2">
            <h2 className="ui-text-section-label-sm ui-color-muted">Setup</h2>

            <div className="grid grid-cols-2 gap-3">
                <button
                    onClick={async () => {
                        try {
                            await invoke("reset_onboarding");
                            window.location.reload();
                        } catch (err) {
                            console.error("Failed to restart onboarding:", err);
                        }
                    }}
                    className="rounded-lg border border-border-primary bg-surface-surface py-2.5 px-3 text-left hover:border-border-secondary transition-colors"
                >
                    <span className="ui-text-label-strong ui-color-primary block">Restart Onboarding</span>
                    <span className="ui-text-micro ui-color-disabled">re-run setup wizard</span>
                </button>

                <button
                    onClick={onOpenFAQ}
                    className="rounded-lg border border-border-primary bg-surface-surface py-2.5 px-3 text-left hover:border-border-secondary transition-colors"
                >
                    <span className="ui-text-label-strong ui-color-primary block">FAQ & Help</span>
                    <span className="ui-text-micro ui-color-disabled">common questions</span>
                </button>
            </div>
        </div>
    </motion.div>
);

export default AboutTab;
