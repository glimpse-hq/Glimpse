import { useLingui } from "@lingui/react/macro";
import { useEffect, useRef, useState } from "react";
import { ArrowUpDown, Check, Copy, Settings2 } from "lucide-react";
import DotMatrix from "../../../shared/ui/DotMatrix";
import type { LocalApiStatus } from "../../../types";

const SIDEBAR_TRANSITION = "transition-[width,opacity,max-height] duration-200 ease-out";

const ACTIVITY_PATTERNS = [
  [0, 3],
  [1, 2],
  [0, 1, 2, 3],
  [0, 1],
  [2, 3],
];

const ActivityDotMatrix = () => {
  const [patternIndex, setPatternIndex] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => {
      setPatternIndex((current) => (current + 1) % ACTIVITY_PATTERNS.length);
    }, 640);
    return () => window.clearInterval(id);
  }, []);

  return (
    <DotMatrix
      rows={2}
      cols={2}
      activeDots={ACTIVITY_PATTERNS[patternIndex]}
      dotSize={3}
      gap={2}
      color="var(--color-text-muted)"
      snapDots
      aria-hidden="true"
    />
  );
};

const LocalApiSidebarStatus = ({
  collapsed,
  status,
  onOpenSettings,
}: {
  collapsed: boolean;
  status: LocalApiStatus;
  onOpenSettings: () => void;
}) => {
  const { t } = useLingui();
  const [copied, setCopied] = useState(false);
  const copyTimeoutRef = useRef<number | null>(null);

  const host = status.host || "127.0.0.1";
  const baseUrl = `http://${host}:${status.port}/v1`;
  const displayUrl = `${host}:${status.port}/v1`;
  const requests = status.requests_total ?? 0;

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current !== null) {
        window.clearTimeout(copyTimeoutRef.current);
      }
    };
  }, []);

  const copyBaseUrl = async () => {
    try {
      await navigator.clipboard.writeText(baseUrl);
      setCopied(true);
      if (copyTimeoutRef.current !== null) {
        window.clearTimeout(copyTimeoutRef.current);
      }
      copyTimeoutRef.current = window.setTimeout(() => {
        setCopied(false);
        copyTimeoutRef.current = null;
      }, 1200);
    } catch {
      setCopied(false);
    }
  };

  const runningLabel = t({
    id: "home.local_api.running",
    message: "Local API",
  });
  const requestsLabel = t({
    id: "home.local_api.requests",
    message: "Requests served",
  });
  const openSettingsLabel = t({
    id: "home.local_api.open_settings",
    message: "Open API server settings",
  });
  const statusHint = t({
    id: "home.local_api.status_hint",
    message: "Your API server is running in the background.",
  });
  const collapsedTitle = `${runningLabel} — ${statusHint} ${displayUrl} · ${requests} ${requestsLabel.toLowerCase()}. ${openSettingsLabel}.`;

  return (
    <div className="shrink-0">
      <button
        type="button"
        onClick={onOpenSettings}
        title={collapsed ? collapsedTitle : openSettingsLabel}
        aria-label={`${runningLabel}. ${statusHint} ${openSettingsLabel}`}
        className={`group flex w-full items-center rounded-lg h-9 pl-[17px] pr-3 text-left text-content-muted hover:bg-[var(--surface-interactive)] hover:text-content-secondary ${
          collapsed ? "gap-0" : "gap-3"
        }`}
      >
        <div className="flex w-[18px] shrink-0 items-center justify-center">
          <ActivityDotMatrix />
        </div>
        <div
          style={{
            width: collapsed ? 0 : "auto",
            opacity: collapsed ? 0 : 1,
          }}
          className={`flex min-w-0 flex-1 items-center justify-between gap-2 overflow-hidden whitespace-nowrap ${SIDEBAR_TRANSITION}`}
        >
          <span className="ui-text-nav-item ui-color-secondary group-hover:text-content-secondary">
            {runningLabel}
          </span>
          <span className="flex shrink-0 items-center gap-1.5">
            <span
              title={requestsLabel}
              className="flex items-center gap-1 text-[11px] tabular-nums ui-color-muted group-hover:text-content-secondary"
            >
              <ArrowUpDown size={11} aria-hidden="true" />
              {requests}
            </span>
            <Settings2
              size={13}
              className="ui-color-disabled opacity-0 transition-opacity group-hover:opacity-100 group-hover:ui-color-muted"
              aria-hidden="true"
            />
          </span>
        </div>
      </button>

      <div
        aria-hidden={collapsed}
        className={`overflow-hidden ${SIDEBAR_TRANSITION} ${
          collapsed
            ? "max-h-0 opacity-0 pointer-events-none"
            : "max-h-6 opacity-100"
        }`}
      >
        <button
          type="button"
          onClick={copyBaseUrl}
          tabIndex={collapsed ? -1 : 0}
          className="group flex h-6 w-full items-center gap-1.5 pl-[17px] pr-3 text-left"
          aria-label={t({
            id: "home.local_api.copy_url",
            message: "Copy base URL",
          })}
        >
          <span className="min-w-0 flex-1 truncate font-mono text-[11px] ui-color-muted transition-colors group-hover:ui-color-secondary">
            {displayUrl}
          </span>
          {copied ? (
            <Check size={12} className="shrink-0 ui-color-secondary" />
          ) : (
            <Copy
              size={12}
              className="shrink-0 ui-color-disabled transition-colors group-hover:ui-color-muted"
            />
          )}
        </button>
      </div>
    </div>
  );
};

export default LocalApiSidebarStatus;
