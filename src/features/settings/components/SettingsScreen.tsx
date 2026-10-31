import { useLingui } from "@lingui/react/macro";
import { useCallback, useState } from "react";
import { useCopyToClipboard } from "../../../shared/hooks/useCopyToClipboard";
import { motion, AnimatePresence } from "framer-motion";
import { Check, Copy } from "@phosphor-icons/react";
import AboutTab from "./tabs/AboutTab";
import AccountTab from "./tabs/AccountTab";
import GeneralTab from "./tabs/GeneralTab";
import LocalApiTab from "./tabs/LocalApiTab";
import LockedFeature from "../../license/components/LockedFeature";
import { useLicenseState } from "../../license/queries";
import ModelsTab from "./tabs/ModelsTab";
import AppTab from "./tabs/AppTab";
import type { PurchaseSource } from "../../license/purchaseConfig";
import { useSettingsForm } from "../useSettingsForm";
import { SETTINGS_PANE_LABELS, type SettingsPane } from "../settingsPanes";

interface SettingsScreenProps {
  active: boolean;
  pane: SettingsPane;
  onPaneChange: (pane: SettingsPane) => void;
  onClose: () => void;
  accountSource?: PurchaseSource;
  focusLicenseKey?: boolean;
  onLicenseKeyFocused?: () => void;
}

const SettingsScreen = ({
  active,
  pane,
  onPaneChange,
  onClose,
  accountSource = "settings_account",
  focusLicenseKey = false,
  onLicenseKeyFocused,
}: SettingsScreenProps) => {
  const { i18n } = useLingui();
  const [apiLicenseKeyFocus, setApiLicenseKeyFocus] = useState(false);
  const handleLicenseKeyFocused = useCallback(() => {
    setApiLicenseKeyFocus(false);
    onLicenseKeyFocused?.();
  }, [onLicenseKeyFocused]);
  const form = useSettingsForm({ pane, active, onClose });
  const licenseLoading = useLicenseState().isLoading;
  // A server that is still running keeps its Stop button.
  const localApiLocked =
    !form.activeLicense &&
    !form.localApiStatus?.running &&
    !form.localApiStatus?.starting;

  if (pane === "api" && licenseLoading) {
    return <div className="flex flex-1 flex-col min-h-0" />;
  }

  return (
    <div className="settings-typescale flex flex-1 flex-col min-h-0">
      <header className="shrink-0 px-8 pb-4">
        <h1 className="ui-text-screen-title ui-color-primary tracking-tight">
          {i18n._(SETTINGS_PANE_LABELS[pane])}
        </h1>
      </header>

      {/* Floats over the pane so an error doesn't push it down. */}
      <div className="relative z-10 h-0">
        <div className="absolute inset-x-8 top-0">
          <SettingsErrorBanner
            error={form.error}
            sourceTab={form.errorSourceTab}
            onOpenPane={onPaneChange}
          />
        </div>
      </div>

      <div
        className="flex flex-1 min-h-0 flex-col px-8 pt-2 pb-6 settings-scroll overflow-y-scroll"
        style={{ scrollbarGutter: "stable" }}
      >
        {form.loading ? null : (
          <>
            {pane === "account" && (
              <AccountTab
                key="account"
                source={accountSource}
                focusLicenseKey={focusLicenseKey || apiLicenseKeyFocus}
                onLicenseKeyFocused={handleLicenseKeyFocused}
              />
            )}

            {pane === "general" && (
              <GeneralTab
                key="general"
                inputDevices={form.inputDevices}
                microphoneDevice={form.microphoneDevice}
                onMicrophoneDeviceChange={form.setMicrophoneDevice}
                language={form.language}
                onLanguageChange={form.setLanguage}
                languages={form.languages}
                shortcutBindings={form.shortcutBindings}
                invalidShortcutDrafts={form.invalidShortcutDrafts}
                captureActive={form.captureActive}
                capturePreview={form.capturePreview}
                onStartCapture={form.handleStartCapture}
                updateShortcutBinding={form.updateShortcutBinding}
                addShortcutBinding={form.addShortcutBinding}
                removeShortcutBinding={form.removeShortcutBinding}
                moveShortcutBinding={form.moveShortcutBinding}
                autoDictionaryEnabled={form.autoDictionaryEnabled}
                autoDictionarySupported={form.autoDictionarySupported}
                setAutoDictionaryEnabled={form.setAutoDictionaryEnabled}
                licenseGateActive={form.licenseGateActive}
                llmProvider={form.llmProvider}
                llmAuto={form.llmAuto}
                llmServiceProvider={form.llmServiceProvider}
                llmEndpoint={form.llmEndpoint}
                llmApiKey={form.llmApiKey}
                llmModel={form.llmModel}
                onOpenAccountTab={() => onPaneChange("account")}
                onOpenModelsTab={() => onPaneChange("models")}
              />
            )}

            {pane === "models" && (
              <ModelsTab
                key="models"
                modelCatalog={form.modelCatalog}
                diarizerModel={form.diarizerModel}
                modelStatus={form.modelStatus}
                downloadState={form.downloadState}
                localModel={form.localModel}
                remoteSpeechEnabled={form.remoteSpeechEnabled}
                setRemoteSpeechEnabled={form.setRemoteSpeechEnabled}
                remoteSpeechProvider={form.remoteSpeechProvider}
                setRemoteSpeechProvider={form.setRemoteSpeechProvider}
                remoteSpeechEndpoint={form.remoteSpeechEndpoint}
                setRemoteSpeechEndpoint={form.setRemoteSpeechEndpoint}
                remoteSpeechApiKey={form.remoteSpeechApiKey}
                setRemoteSpeechApiKey={form.setRemoteSpeechApiKey}
                remoteSpeechModel={form.remoteSpeechModel}
                setRemoteSpeechModel={form.setRemoteSpeechModel}
                remoteSpeechConfigReady={form.remoteSpeechConfigReady}
                llmProvider={form.llmProvider}
                setLlmProvider={form.setLlmProvider}
                llmEndpoint={form.llmEndpoint}
                setLlmEndpoint={form.setLlmEndpoint}
                llmApiKey={form.llmApiKey}
                setLlmApiKey={form.setLlmApiKey}
                llmModel={form.llmModel}
                setLlmModel={form.setLlmModel}
                llmServiceProvider={form.llmServiceProvider}
                setLlmServiceProvider={form.setLlmServiceProvider}
                llmAuto={form.llmAuto}
                setLlmAuto={form.setLlmAuto}
                cleanupOffEverywhere={form.cleanupOffEverywhere}
                onOpenShortcuts={() => onPaneChange("general")}
                licenseGateActive={form.licenseGateActive}
                setLocalModel={form.setLocalModel}
                handleDownload={form.handleDownload}
                handleDelete={form.handleDelete}
                handleCancelDownload={form.handleCancelDownload}
              />
            )}

            {pane === "app" && (
              <AppTab
                key="app"
                active={active}
                micPermission={form.micPermission}
                accessibilityPermission={form.accessibilityPermission}
                inputMonitoringPermission={form.inputMonitoringPermission}
                onRequestMicrophonePermission={
                  form.handleRequestMicrophonePermission
                }
                onRequestAccessibilityPermission={
                  form.handleRequestAccessibilityPermission
                }
                onRequestInputMonitoringPermission={
                  form.handleRequestInputMonitoringPermission
                }
                textSizeMode={form.textSizeMode}
                onTextSizeModeChange={form.setTextSizeMode}
                themeMode={form.themeMode}
                onThemeModeChange={form.setThemeMode}
                appLocale={form.appLocale}
                onAppLocaleChange={form.setAppLocale}
                mediaAction={form.mediaAction}
                onMediaActionChange={form.setMediaAction}
                autoUpdateEnabled={form.autoUpdateEnabled}
                onAutoUpdateEnabledChange={form.setAutoUpdateEnabled}
                storeBuild={form.appInfo?.store_build ?? false}
                autoLaunchEnabled={form.autoLaunchEnabled}
                onAutoLaunchEnabledChange={form.setAutoLaunchEnabled}
                startInBackground={form.startInBackground}
                onStartInBackgroundChange={form.setStartInBackground}
                autoDeleteTarget={form.autoDeleteTarget}
                onAutoDeleteTargetChange={form.setAutoDeleteTarget}
                autoDeleteDuration={form.autoDeleteDuration}
                onAutoDeleteDurationChange={form.setAutoDeleteDuration}
                analyticsEnabled={form.analyticsEnabled}
                onAnalyticsEnabledChange={form.setAnalyticsEnabled}
                platformCapabilities={form.platformCapabilities}
              />
            )}

            {pane === "about" && (
              <AboutTab
                key="about"
                active={active}
                appInfo={form.appInfo}
                appInfoFailed={form.appInfoFailed}
                cliInstallStatus={form.cliInstallStatus}
                activeLicense={form.activeLicense}
                onCliError={(message) =>
                  form.showSettingsError(message, "about")
                }
                onOpenDataDir={form.handleOpenDataDir}
              />
            )}

            {pane === "api" && (
              <div className="relative flex min-h-0 flex-1 flex-col">
                <div
                  inert={localApiLocked}
                  className={`flex min-h-0 flex-1 flex-col ${localApiLocked ? "opacity-60 blur-[1px]" : ""}`}
                >
                  <LocalApiTab
                    key="api"
                    modelCatalog={form.modelCatalog}
                    modelStatus={form.modelStatus}
                    apiKey={form.localApiKey}
                    setApiKey={form.setLocalApiKey}
                    port={form.localApiPort}
                    setPort={form.setLocalApiPort}
                    model={form.localApiModel}
                    setModel={form.setLocalApiModel}
                    host={form.localApiHost}
                    setHost={form.setLocalApiHost}
                    startOnLaunch={form.localApiStartOnLaunch}
                    setStartOnLaunch={form.setLocalApiStartOnLaunch}
                    cors={form.localApiCors}
                    setCors={form.setLocalApiCors}
                    status={form.localApiStatus}
                    busy={form.localApiBusy}
                    stopping={form.localApiStopping}
                    onStart={form.handleStartLocalApi}
                    onStop={form.handleStopLocalApi}
                    onRestart={form.handleRestartLocalApi}
                    onClearLogs={form.handleClearLocalApiLogs}
                  />
                </div>
                {localApiLocked && (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="w-full max-w-sm rounded-2xl border border-border-primary bg-surface-tertiary p-5 ui-shadow-modal-deep">
                      <LockedFeature
                        feature="api"
                        compact
                        onEnterKey={() => {
                          setApiLicenseKeyFocus(true);
                          onPaneChange("account");
                        }}
                      />
                    </div>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

const SettingsErrorBanner = ({
  error,
  sourceTab,
  onOpenPane,
}: {
  error: string | null;
  sourceTab: Exclude<SettingsPane, "account"> | null;
  onOpenPane: (pane: SettingsPane) => void;
}) => {
  const { t } = useLingui();
  const { copied, copy } = useCopyToClipboard(1500);

  const handleCopy = () => {
    if (error) copy(error);
  };

  return (
    <AnimatePresence initial={false}>
      {error && (
        <motion.div
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 4 }}
          transition={{ duration: 0.12, ease: "easeOut" }}
          className="rounded-md bg-surface-surface shadow-sm"
          role="alert"
        >
          <div
            className={`rounded-md border border-error/20 bg-error/5 px-2 py-1.5 ${
              sourceTab
                ? "cursor-pointer transition-colors hover:bg-error/10"
                : ""
            }`}
            onClick={() => {
              if (sourceTab) onOpenPane(sourceTab);
            }}
          >
            <p className="break-words [overflow-wrap:anywhere] ui-text-meta ui-color-error leading-snug">
              {sourceTab ? (
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onOpenPane(sourceTab);
                  }}
                  className="text-left"
                >
                  {error}
                </button>
              ) : (
                <span>{error}</span>
              )}
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  handleCopy();
                }}
                className="ml-1 inline-flex align-[-2px] text-error/60 transition-colors hover:text-error"
                aria-label={t({
                  id: "settings.error.copy",
                  message: "Copy error",
                })}
              >
                {copied ? (
                  <Check size={11} aria-hidden="true" />
                ) : (
                  <Copy size={11} aria-hidden="true" />
                )}
              </button>
            </p>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default SettingsScreen;
