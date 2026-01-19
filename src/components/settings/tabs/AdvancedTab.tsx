import { invoke } from "@tauri-apps/api/core";
import { motion, type Variants } from "framer-motion";
import { Check, Loader2 } from "lucide-react";
import { requestAccessibilityPermission } from "tauri-plugin-macos-permissions-api";

type AdvancedTabProps = {
    variants: Variants;
    micPermission: boolean | null;
    accessibilityPermission: boolean | null;
};

const AdvancedTab = ({ variants, micPermission, accessibilityPermission }: AdvancedTabProps) => (
    <motion.div
        key="advanced"
        variants={variants}
        initial="hidden"
        animate="visible"
        exit="exit"
        className="space-y-6"
    >
        <div className="space-y-2">
            <h2 className="text-[11px] font-semibold uppercase tracking-wider text-content-muted">Permissions</h2>

            <div className="grid grid-cols-2 gap-2">
                <div className="rounded-lg border border-border-primary bg-surface-surface">
                    <div className="py-2.5 px-3">
                        <div className="flex items-center justify-between">
                            <span className="text-[11px] font-medium text-content-primary">Microphone</span>
                            {micPermission === null ? (
                                <Loader2 size={10} className="animate-spin text-content-muted" aria-label="Checking permission" />
                            ) : micPermission ? (
                                <span className="text-[10px] text-success flex items-center gap-1">
                                    <Check size={10} aria-hidden="true" />
                                    <span className="sr-only">Enabled</span>
                                </span>
                            ) : (
                                <span className="text-[10px] text-warning">off</span>
                            )}
                        </div>
                        <span className="text-[9px] text-content-disabled block mt-0.5">required for transcription</span>
                        <button
                            onClick={() => invoke("open_microphone_settings")}
                            className="mt-2 text-[10px] text-content-muted hover:text-content-secondary transition-colors"
                        >
                            Open Settings
                        </button>
                    </div>
                </div>

                <div className="rounded-lg border border-border-primary bg-surface-surface">
                    <div className="py-2.5 px-3">
                        <div className="flex items-center justify-between">
                            <span className="text-[11px] font-medium text-content-primary">Accessibility</span>
                            {accessibilityPermission === null ? (
                                <Loader2 size={10} className="animate-spin text-content-muted" aria-label="Checking permission" />
                            ) : accessibilityPermission ? (
                                <span className="text-[10px] text-success flex items-center gap-1">
                                    <Check size={10} aria-hidden="true" />
                                    <span className="sr-only">Enabled</span>
                                </span>
                            ) : (
                                <span className="text-[10px] text-warning">off</span>
                            )}
                        </div>
                        <span className="text-[9px] text-content-disabled block mt-0.5">required for auto-paste</span>
                        <button
                            onClick={async () => {
                                try {
                                    const granted = await requestAccessibilityPermission();
                                    if (!granted) await invoke("open_accessibility_settings");
                                } catch {
                                    await invoke("open_accessibility_settings");
                                }
                            }}
                            className="mt-2 text-[10px] text-content-muted hover:text-content-secondary transition-colors"
                        >
                            Open Settings
                        </button>
                    </div>
                </div>
            </div>

            <p className="text-[9px] text-content-disabled px-0.5">
                Restart Glimpse after changing permissions in System Settings.
            </p>
        </div>
    </motion.div>
);

export default AdvancedTab;
