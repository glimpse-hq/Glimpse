import { useMemo, useRef, useEffect, useState, useCallback } from "react";
import { motion, type Variants } from "framer-motion";
import ToggleSwitch from "../../../../shared/ui/ToggleSwitch";
import { Dropdown } from "../../../../shared/ui/Dropdown";
import type { LocalApiStatus, ModelInfo, ModelStatus } from "../../../../types";

type LocalApiTabProps = {
  variants: Variants;
  modelCatalog: ModelInfo[];
  modelStatus: Record<string, ModelStatus>;
  apiKey: string;
  setApiKey: (value: string) => void;
  port: number;
  setPort: (value: number) => void;
  model: string;
  setModel: (value: string) => void;
  host: string;
  setHost: (value: string) => void;
  startOnLaunch: boolean;
  setStartOnLaunch: (value: boolean) => void;
  cors: boolean;
  setCors: (value: boolean) => void;
  status: LocalApiStatus | null;
  busy: boolean;
  onStart: () => void;
  onStop: () => void;
  onRestart: () => void;
  onClearLogs: () => void;
};

const LocalApiTab = ({
  variants,
  modelCatalog,
  modelStatus,
  apiKey,
  setApiKey,
  port,
  setPort,
  model,
  setModel,
  host,
  setHost,
  startOnLaunch,
  setStartOnLaunch,
  cors,
  setCors,
  status,
  busy,
  onStart,
  onStop,
  onRestart,
  onClearLogs,
}: LocalApiTabProps) => {
  const [copied, setCopied] = useState(false);
  const [logsCopied, setLogsCopied] = useState(false);
  const [runningApiKeySnapshot, setRunningApiKeySnapshot] = useState<{
    configId: number;
    value: string;
  } | null>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const installedModels = modelCatalog.filter(
    (entry) => modelStatus[entry.key]?.installed,
  );
  const running = status?.running ?? false;
  const logs = status?.logs ?? [];
  const effectiveHost = running ? (status?.host ?? host) : host;
  const effectivePort = running ? (status?.port ?? port) : port;
  const baseUrl = `http://${effectiveHost}:${effectivePort}/v1`;
  const requireApiKey = apiKey.trim().length > 0;
  const configuredApiKey = requireApiKey ? apiKey.trim() : "";
  const lanEnabled = host === "0.0.0.0";
  const lanRequiresApiKey = lanEnabled && !requireApiKey;
  const runningConfigId = status?.config_id ?? null;
  const runningApiKey =
    runningApiKeySnapshot?.configId === runningConfigId
      ? runningApiKeySnapshot.value
      : configuredApiKey;
  const restartRequired =
    running &&
    ((status?.host ?? host) !== host ||
      (status?.port ?? port) !== port ||
      (status?.model ?? model) !== model ||
      (status?.api_key_required ?? requireApiKey) !== requireApiKey ||
      runningApiKey !== configuredApiKey ||
      (status?.cors ?? cors) !== cors);

  const modelOptions = useMemo(() => {
    return [
      { value: "auto", label: "None" },
      ...installedModels.map((entry) => ({
        value: entry.key,
        label: entry.label,
      })),
    ];
  }, [installedModels]);

  const modelLabelByKey = useMemo(() => {
    const map = new Map(modelCatalog.map((entry) => [entry.key, entry.label]));
    map.set("auto", "None");
    return map;
  }, [modelCatalog]);

  const loadedModelLabel = status?.loaded_model
    ? (modelLabelByKey.get(status.loaded_model) ?? status.loaded_model)
    : "None";

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs.length]);

  useEffect(() => {
    if (!running || runningConfigId === null) {
      setRunningApiKeySnapshot(null);
      return;
    }

    setRunningApiKeySnapshot((current) =>
      current?.configId === runningConfigId
        ? current
        : { configId: runningConfigId, value: configuredApiKey },
    );
  }, [configuredApiKey, running, runningConfigId]);

  const copyBaseUrl = async () => {
    try {
      await navigator.clipboard.writeText(baseUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  };

  const copyLogs = useCallback(async () => {
    if (logs.length === 0) return;
    const text = logs
      .map((entry) => `[${entry.level}] ${entry.message}`)
      .join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setLogsCopied(true);
      window.setTimeout(() => setLogsCopied(false), 1200);
    } catch {
      setLogsCopied(false);
    }
  }, [logs]);

  return (
    <motion.div
      key="local-api"
      variants={variants}
      initial="hidden"
      animate="visible"
      exit="exit"
      className="flex h-full flex-col gap-6"
    >
      <div className="flex items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <span
              className={`w-2 h-2 rounded-full shrink-0 transition-all duration-300 ${running ? "bg-green-400 shadow-[0_0_6px_rgba(74,222,128,0.5)]" : "bg-content-disabled"}`}
            />
            <h1 className="ui-text-title-lg font-medium ui-color-primary">
              {running ? "Running" : "Stopped"}
            </h1>
          </div>
          <button
            className="mt-1 ui-text-body-sm ui-color-muted hover:ui-color-primary transition-colors inline-flex items-center gap-1.5 group"
            onClick={copyBaseUrl}
            type="button"
          >
            <span>{copied ? "Copied!" : baseUrl}</span>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="opacity-60 group-hover:opacity-100 transition-opacity"
              aria-hidden="true"
            >
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
          </button>
          <button
            type="button"
            onClick={onRestart}
            disabled={busy || !restartRequired || !running || lanRequiresApiKey}
            className={`mt-0.5 ui-text-label ui-color-warning flex items-center gap-1 hover:brightness-110 transition-opacity duration-200 group ${restartRequired ? "opacity-100" : "opacity-0 pointer-events-none"}`}
          >
            <span>Restart to apply changes</span>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="11"
              height="11"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.25"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="transition-transform duration-200 group-hover:scale-110"
              aria-hidden="true"
            >
              <path d="M12 2v10" />
              <path d="M18.4 6.6a9 9 0 1 1-12.77.04" />
            </svg>
          </button>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {running ? (
            <button
              className="w-[92px] px-5 py-1.5 rounded-lg bg-red-500 hover:bg-red-400 text-white ui-text-button-sm font-semibold transition-all shadow-[0_3px_0_-1px_rgba(248,113,113,0.35),inset_0_1px_0_0_rgba(255,255,255,0.15)] active:translate-y-[1px] active:shadow-none"
              onClick={onStop}
              disabled={busy}
            >
              Stop API
            </button>
          ) : (
            <button
              className="w-[92px] px-5 py-1.5 rounded-lg bg-content-primary hover:bg-content-secondary text-surface-secondary ui-text-button-sm font-semibold transition-all shadow-[0_3px_0_-1px_rgba(255,255,255,0.25),inset_0_1px_0_0_rgba(255,255,255,0.1)] active:translate-y-[1px] active:shadow-none"
              onClick={onStart}
              disabled={busy || lanRequiresApiKey}
            >
              Start API
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 items-stretch">
        <div className="space-y-2 flex flex-col">
          <h2 className="ui-text-section-label-sm ui-color-muted shrink-0">
            Configuration
          </h2>

          <div className="flex-1 rounded-lg bg-surface-surface p-2.5 space-y-6">
            <div className="px-2 py-1.5 flex gap-5">
              <label className="shrink-0">
                <span className="ui-text-label-strong ui-color-primary block">
                  Port
                </span>
                <input
                  className="mt-1.5 w-[46px] border-b border-border-secondary bg-transparent px-0.5 py-1 ui-text-body-sm ui-color-primary focus:outline-none focus:border-content-primary transition-colors tabular-nums [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  type="number"
                  min={1}
                  max={65535}
                  value={port}
                  onChange={(event) => {
                    const value = Number(event.target.value) || 11435;
                    setPort(Math.min(65535, Math.max(1, value)));
                  }}
                />
              </label>
              <div className="flex-1 min-w-0">
                <span className="ui-text-label-strong ui-color-primary block">
                  API key
                </span>
                <input
                  className="mt-1.5 w-full border-b border-border-secondary bg-transparent px-0.5 py-1 ui-text-body-sm ui-color-primary focus:outline-none focus:border-content-primary transition-colors"
                  type="password"
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                  placeholder={lanEnabled ? "Required for LAN access" : "Optional - blank to disable"}
                />
                {lanRequiresApiKey && (
                  <span className="ui-text-micro ui-color-warning block mt-1">
                    Required when listening on LAN
                  </span>
                )}
              </div>
            </div>

            <div className="px-2 py-1.5">
              <span className="ui-text-label-strong ui-color-primary block">
                Preloaded model
              </span>
              <div className="mt-1.5 relative z-10">
                <Dropdown
                  value={model}
                  onChange={setModel}
                  options={modelOptions}
                  buttonClassName="!rounded-none !border-0 !border-b !border-border-secondary !bg-transparent !px-0.5 !py-1 ui-text-body-sm hover:!border-content-primary focus:!border-content-primary"
                  truncate={false}
                />
              </div>
              <span className="ui-text-micro ui-color-disabled block mt-1">
                {model === "auto"
                  ? running && status?.loaded_model
                    ? `currently loaded: ${loadedModelLabel}`
                    : "no model held in memory between requests"
                  : "kept warm in memory for fast responses"}
              </span>
            </div>
          </div>
        </div>

        <div className="space-y-2 flex flex-col">
          <h2 className="ui-text-section-label-sm ui-color-muted shrink-0">
            Behavior
          </h2>

          <div className="flex-1 rounded-lg bg-surface-surface p-2.5 space-y-6">
            <div className="px-2 py-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="ui-text-label-strong ui-color-primary">
                  Listen on LAN
                </span>
                <ToggleSwitch
                  enabled={lanEnabled}
                  onToggle={() =>
                    setHost(lanEnabled ? "127.0.0.1" : "0.0.0.0")
                  }
                  ariaLabel="Listen on LAN"
                />
              </div>
              <span className="ui-text-micro ui-color-disabled block mt-0.5">
                expose to other devices on your network
              </span>
            </div>

            <div className="px-2 py-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="ui-text-label-strong ui-color-primary">
                  Start on launch
                </span>
                <ToggleSwitch
                  enabled={startOnLaunch}
                  onToggle={() => setStartOnLaunch(!startOnLaunch)}
                  ariaLabel="Start local API when Glimpse opens"
                />
              </div>
              <span className="ui-text-micro ui-color-disabled block mt-0.5">
                automatically start when Glimpse opens
              </span>
            </div>

            <div className="px-2 py-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="ui-text-label-strong ui-color-primary">
                  Allow browser requests
                </span>
                <ToggleSwitch
                  enabled={cors}
                  onToggle={() => setCors(!cors)}
                  ariaLabel="Allow cross-origin browser requests"
                />
              </div>
              <span className="ui-text-micro ui-color-disabled block mt-0.5">
                send CORS headers so web apps can call the API
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between border-b border-border-primary pb-2">
          <h2 className="ui-text-section-label-sm ui-color-disabled">Logs</h2>
          <div
            className={`flex items-center gap-3 transition-opacity ${logs.length > 0 ? "opacity-100" : "opacity-0 pointer-events-none"}`}
          >
            <button
              className="ui-text-meta ui-color-muted hover:ui-color-primary transition-colors inline-flex items-center gap-1"
              onClick={copyLogs}
              type="button"
              aria-label="Copy logs"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="11"
                height="11"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
              <span>{logsCopied ? "Copied" : "Copy"}</span>
            </button>
            <button
              className="ui-text-meta ui-color-muted hover:text-red-400 transition-colors"
              onClick={onClearLogs}
              type="button"
            >
              Clear
            </button>
          </div>
        </div>

        <div className="h-[210px] overflow-y-auto">
          {logs.length === 0 ? (
            <p className="ui-text-label ui-color-disabled">No logs yet.</p>
          ) : (
            <div className="space-y-px selectable">
              {logs.map((entry) => (
                <div
                  key={entry.id}
                  className="ui-text-meta ui-color-api-log font-mono leading-relaxed py-0.5"
                >
                  <span className="ui-color-api-log-level">[{entry.level}]</span>{" "}
                  {entry.message}
                </div>
              ))}
              <div ref={logsEndRef} />
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
};

export default LocalApiTab;
