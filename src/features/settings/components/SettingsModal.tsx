import { useLingui } from "@lingui/react/macro";
import { type ReactNode } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { AppWindow, Cpu, Info, Keyboard, User, X } from "lucide-react";
import FAQModal from "../../../shared/ui/FAQModal";
import WhatsNewModal from "../../updates/components/WhatsNewModal";
import AboutTab from "./tabs/AboutTab";
import AccountTab from "./tabs/AccountTab";
import GeneralTab from "./tabs/GeneralTab";
import ModelsTab from "./tabs/ModelsTab";
import AppTab from "./tabs/AppTab";
import type { User as AuthUser } from "../../auth/api";
import type { TranscriptionMode } from "../../../types";
import { useSettingsForm } from "../useSettingsForm";

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialTab?: "general" | "account" | "models" | "about" | "app";
  currentUser: AuthUser | null;
  onUpdateUser: () => Promise<void>;
  transcriptionMode: TranscriptionMode;
}

const backdropVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1 },
};

const modalVariants = {
  hidden: { opacity: 0, scale: 0.97, y: 6 },
  visible: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: { type: "spring" as const, stiffness: 400, damping: 30 },
  },
  exit: {
    opacity: 0,
    scale: 0.97,
    y: 6,
    transition: { duration: 0.12 },
  },
};

const tabContentVariants = {
  hidden: { opacity: 1, x: 0 },
  visible: { opacity: 1, x: 0, transition: { duration: 0 } },
  exit: { opacity: 1, x: 0, transition: { duration: 0 } },
};

const SettingsModal = ({
  isOpen,
  onClose,
  initialTab = "general",
  currentUser,
  onUpdateUser,
  transcriptionMode: initialTranscriptionMode,
}: SettingsModalProps) => {
  const { t } = useLingui();
  const form = useSettingsForm({
    isOpen,
    onClose,
    initialTab,
    currentUser,
    onUpdateUser,
    transcriptionMode: initialTranscriptionMode,
  });

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center"
          initial="hidden"
          animate="visible"
          exit="hidden"
        >
          <motion.div
            className="absolute inset-0 bg-black/60 backdrop-blur-xs"
            variants={backdropVariants}
            onClick={onClose}
          />

          <motion.div
            className="relative flex max-h-[80vh] h-[625px] w-[850px] overflow-hidden rounded-2xl border border-border-secondary bg-surface-overlay shadow-2xl shadow-black/50"
            variants={modalVariants}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label={t({
              id: "settings.modal.dialog_label",
              message: "Settings",
            })}
          >
            <motion.button
              onClick={onClose}
              className="absolute right-2 top-3 z-20 flex h-7 w-7 items-center justify-center rounded-lg text-content-muted hover:bg-surface-elevated hover:text-content-secondary transition-colors"
              whileTap={{ scale: 0.95 }}
              aria-label={t({
                id: "settings.modal.close_button",
                message: "Close settings",
              })}
            >
              <X size={14} aria-hidden="true" />
            </motion.button>

            <aside className="flex w-44 flex-col border-r border-border-primary bg-surface-surface">
              <div className="px-4 pt-5 pb-4">
                <h2 className="ui-text-title-strong ui-color-primary">
                  {t({
                    id: "settings.modal.title",
                    message: "Settings",
                  })}
                </h2>
              </div>
              <nav className="flex-1 px-2 space-y-4">
                <div className="space-y-1">
                  <p className="px-2.5 pb-1.5 ui-text-uppercase-meta ui-color-disabled font-semibold">
                    {t({
                      id: "settings.modal.section.account",
                      message: "Account",
                    })}
                  </p>
                  <ModalNavItem
                    icon={<User size={14} aria-hidden="true" />}
                    label={t({
                      id: "settings.modal.tab.account",
                      message: "Account",
                    })}
                    active={form.activeTab === "account"}
                    onClick={() => form.setActiveTab("account")}
                  />
                </div>

                <div className="space-y-1">
                  <p className="px-2.5 pb-1.5 ui-text-uppercase-meta ui-color-disabled font-semibold">
                    {t({
                      id: "settings.modal.section.general",
                      message: "General",
                    })}
                  </p>
                  <ModalNavItem
                    icon={<Keyboard size={14} aria-hidden="true" />}
                    label={t({
                      id: "settings.modal.tab.general",
                      message: "General",
                    })}
                    active={form.activeTab === "general"}
                    onClick={() => form.setActiveTab("general")}
                  />
                  <ModalNavItem
                    icon={<AppWindow size={14} aria-hidden="true" />}
                    label={t({
                      id: "settings.modal.tab.app",
                      message: "App",
                    })}
                    active={form.activeTab === "app"}
                    onClick={() => form.setActiveTab("app")}
                  />
                  <ModalNavItem
                    icon={<Info size={14} aria-hidden="true" />}
                    label={t({
                      id: "settings.modal.tab.about",
                      message: "About",
                    })}
                    active={form.activeTab === "about"}
                    onClick={() => form.setActiveTab("about")}
                  />
                </div>

                <AnimatePresence>
                  {!form.loading && form.transcriptionMode === "local" && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.15 }}
                    >
                      <p className="px-2.5 pb-1.5 ui-text-uppercase-meta ui-color-disabled font-semibold">
                        {t({
                          id: "settings.modal.section.local",
                          message: "Local",
                        })}
                      </p>
                      <ModalNavItem
                        icon={<Cpu size={14} aria-hidden="true" />}
                        label={t({
                          id: "settings.modal.tab.models",
                          message: "Models",
                        })}
                        active={form.activeTab === "models"}
                        onClick={() => form.setActiveTab("models")}
                      />
                    </motion.div>
                  )}
                </AnimatePresence>
              </nav>
            </aside>

            <main className="flex flex-1 flex-col min-h-0 bg-surface-overlay">
              <div
                className="flex-1 min-h-0 overflow-y-scroll px-6 pt-8 pb-5 settings-scroll"
                style={{ scrollbarGutter: "stable" }}
              >
                {form.loading ? null : (
                <AnimatePresence mode="wait">
                  {form.activeTab === "account" && (
                    <AccountTab
                      variants={tabContentVariants}
                      authLoading={form.authLoading}
                      currentUser={form.currentUser}
                      cloudSyncEnabled={form.cloudSyncEnabled}
                      setCloudSyncEnabled={form.setCloudSyncEnabled}
                      onUpdateUser={form.onUpdateUser}
                      handleSignOut={form.handleSignOut}
                      handleCancelAuth={form.handleCancelAuth}
                    />
                  )}

                  {form.activeTab === "general" && (
                    <GeneralTab
                      variants={tabContentVariants}
                      transcriptionMode={form.transcriptionMode}
                      onTranscriptionModeChange={form.setTranscriptionMode}
                      modelStatus={form.modelStatus}
                      localModel={form.localModel}
                      onOpenModelsTab={() => form.setActiveTab("models")}
                      inputDevices={form.inputDevices}
                      microphoneDevice={form.microphoneDevice}
                      onMicrophoneDeviceChange={form.setMicrophoneDevice}
                      language={form.language}
                      onLanguageChange={form.setLanguage}
                      languages={form.languages}
                      languageBadgeColumns={form.languageBadgeColumns}
                      showLanguageSupportBadges={form.showLanguageSupportBadges}
                      smartShortcut={form.smartShortcut}
                      smartEnabled={form.smartEnabled}
                      setSmartEnabled={form.setSmartEnabled}
                      holdShortcut={form.holdShortcut}
                      holdEnabled={form.holdEnabled}
                      setHoldEnabled={form.setHoldEnabled}
                      toggleShortcut={form.toggleShortcut}
                      toggleEnabled={form.toggleEnabled}
                      setToggleEnabled={form.setToggleEnabled}
                      captureActive={form.captureActive}
                      capturePreview={form.capturePreview}
                      onStartCapture={form.handleStartCapture}
                      error={form.error}
                      errorCopied={form.errorCopied}
                      setErrorCopied={form.setErrorCopied}
                      editModeEnabled={form.editModeEnabled}
                      setEditModeEnabled={form.setEditModeEnabled}
                      cleanupEnabled={form.cleanupEnabled}
                      setCleanupEnabled={form.setCleanupEnabled}
                      aiFeaturesReady={form.aiFeaturesReady}
                    />
                  )}

                  {form.activeTab === "models" && (
                    <ModelsTab
                      variants={tabContentVariants}
                      llmEnabled={form.llmEnabled}
                      setLlmEnabled={form.setLlmEnabled}
                      llmProvider={form.llmProvider}
                      setLlmProvider={form.setLlmProvider}
                      llmEndpoint={form.llmEndpoint}
                      setLlmEndpoint={form.setLlmEndpoint}
                      llmApiKey={form.llmApiKey}
                      setLlmApiKey={form.setLlmApiKey}
                      llmModel={form.llmModel}
                      setLlmModel={form.setLlmModel}
                      availableModels={form.availableModels}
                      fetchAvailableModels={form.fetchAvailableModels}
                      modelCatalog={form.modelCatalog}
                      modelStatus={form.modelStatus}
                      downloadState={form.downloadState}
                      localModel={form.localModel}
                      setLocalModel={form.setLocalModel}
                      handleDownload={form.handleDownload}
                      handleDelete={form.handleDelete}
                      handleCancelDownload={form.handleCancelDownload}
                      formatBytes={form.formatBytes}
                    />
                  )}

                  {form.activeTab === "app" && (
                    <AppTab
                      variants={tabContentVariants}
                      micPermission={form.micPermission}
                      accessibilityPermission={form.accessibilityPermission}
                      textSizeMode={form.textSizeMode}
                      onTextSizeModeChange={form.setTextSizeMode}
                      appLocale={form.appLocale}
                      onAppLocaleChange={form.setAppLocale}
                      mediaControlEnabled={form.mediaControlEnabled}
                      onMediaControlEnabledChange={
                        form.setMediaControlEnabled
                      }
                      autoUpdateEnabled={form.autoUpdateEnabled}
                      onAutoUpdateEnabledChange={form.setAutoUpdateEnabled}
                      recordingPrunePolicy={form.recordingPrunePolicy}
                      onRecordingPrunePolicyChange={form.setRecordingPrunePolicy}
                      analyticsEnabled={form.analyticsEnabled}
                      onAnalyticsEnabledChange={form.setAnalyticsEnabled}
                    />
                  )}

                  {form.activeTab === "about" && (
                    <AboutTab
                      variants={tabContentVariants}
                      appInfo={form.appInfo}
                      formatBytes={form.formatBytes}
                      onOpenDataDir={form.handleOpenDataDir}
                      onOpenFAQ={() => form.setShowFAQModal(true)}
                    />

                  )}
                </AnimatePresence>
                )}
              </div>
            </main>
          </motion.div>
        </motion.div>
      )}

      <FAQModal
        isOpen={form.showFAQModal}
        onClose={() => form.setShowFAQModal(false)}
      />
      <WhatsNewModal
        isOpen={form.whatsNewOpen}
        onClose={() => form.setWhatsNewOpen(false)}
      />

    </AnimatePresence>
  );
};

const ModalNavItem = ({
  icon,
  label,
  active,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}) => (
  <motion.button
    onClick={onClick}
    className={`group flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 ui-text-body-sm-strong transition-colors ${
      active
        ? "bg-surface-elevated ui-color-primary"
        : "ui-color-muted hover:bg-surface-elevated hover:text-content-secondary"
    }`}
    whileTap={{ scale: 0.98 }}
  >
    <div className={active ? "text-cloud/80" : "text-content-disabled"}>
      {icon}
    </div>
    {label}
  </motion.button>
);

export default SettingsModal;
