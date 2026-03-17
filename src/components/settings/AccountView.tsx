import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Loader2,
  LogOut,
  Monitor,
  Pencil,
  Smartphone,
} from "lucide-react";
import {
  deleteSessionById,
  listSessions,
  signOutOtherSessions,
  updateName,
  type Session as AuthSession,
  type User as AuthUser,
} from "../../lib/auth";

const AppleIcon = ({ className }: { className?: string }) => (
  <svg
    viewBox="0 0 24 24"
    fill="currentColor"
    className={className}
    height="1em"
    width="1em"
  >
    <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.74 1.18 0 2.21-.89 3.12-1.13.57-.15 2.18-.09 3.3.93-2.6 1.4-1.92 5.06 1.34 6.25-.9 2.56-2.05 4.96-2.84 6.18zm-2.17-14.8c1.37-1.78 1.05-3.36 1.05-3.36s-1.35-.11-3.23 2.1c-1.43 1.57-1.16 3.16-1.16 3.16s1.6.14 3.34-1.9z" />
  </svg>
);

const WindowsIcon = ({ className }: { className?: string }) => (
  <svg
    viewBox="0 0 24 24"
    fill="currentColor"
    className={className}
    height="1em"
    width="1em"
  >
    <path d="M0 3.449L9.75 2.1v9.451H0V3.449zm10.949-1.67L24 0v11.4H10.949V1.779zM0 12.6h9.75v9.451L0 20.699V12.6zm10.949 0H24v11.4l-13.051-1.83V12.6z" />
  </svg>
);

const LinuxIcon = ({ className }: { className?: string }) => (
  <svg
    viewBox="0 0 24 24"
    fill="currentColor"
    className={className}
    height="1em"
    width="1em"
  >
    <path d="M12 20.125c-.273-.027-.582-.086-.777-.145-.723-.21-1.332-.777-1.605-1.492-.125-.328-.133-.426-.133-1.473V15.75l-.348-.687c-.894-1.77-1.074-2.844-.645-3.832.254-.582.434-.824 1.153-1.57 1.476-1.532 2.761-2.036 4.605-1.801.766.097 1.25.261 1.84.62 1.352.825 2.05 2.145 2.016 3.801-.027 1.426-.645 2.723-1.637 3.442l-.527.382v1.27c0 1.215-.016 1.304-.219 1.636-.312.512-1.015.825-1.777.786-.336-.016-.621-.059-.836-.125l-.234-.07-.305.21c-.496.34-1.02.438-1.57.294zm3.07-1.312c.328-.157.653-.563.805-1.012.055-.164.098-.59.098-1.734v-1.492l.48-.344c1.192-.851 1.649-2.277 1.157-3.605-.332-.903-1.254-1.684-2.223-1.883-.355-.074-1.16-.063-1.488.02-1.715.421-2.613 1.957-2.05 3.507.242.66.726 1.348 1.277 1.817l.422.363v1.64c0 1.489.02 1.579.282 1.805.27.235.805.239 1.242.016v-.098z" />
  </svg>
);

interface AccountViewProps {
  currentUser: AuthUser | null;
  cloudSyncEnabled: boolean;
  onCloudSyncToggle: () => void;
  onUserUpdate: () => void;
  onSignOut: () => void;
}

function formatTimestamp(timestamp?: number | null) {
  if (!timestamp) {
    return "Unknown";
  }
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(timestamp));
}

function getOsIcon(osName: string | undefined, clientName: string | undefined) {
  const lowerOs = osName?.toLowerCase() ?? "";
  const lowerClient = clientName?.toLowerCase() ?? "";

  if (
    lowerOs.includes("mac") ||
    lowerOs.includes("darwin") ||
    lowerOs.includes("ios")
  ) {
    return <AppleIcon className="h-4 w-4 text-content-secondary" />;
  }
  if (lowerOs.includes("win")) {
    return <WindowsIcon className="h-4 w-4 text-content-secondary" />;
  }
  if (
    lowerOs.includes("linux") ||
    lowerOs.includes("ubuntu") ||
    lowerOs.includes("debian")
  ) {
    return <LinuxIcon className="h-4 w-4 text-content-secondary" />;
  }
  if (lowerOs.includes("android") || lowerClient.includes("phone")) {
    return <Smartphone size={16} className="text-content-secondary" />;
  }

  return <Monitor size={16} className="text-content-secondary" />;
}

function formatSessionDetails(session: AuthSession) {
  const parts: string[] = [];
  if (session.osName) {
    parts.push(
      session.osVersion ? `${session.osName} ${session.osVersion}` : session.osName,
    );
  }
  if (session.appVersion) {
    parts.push(`Glimpse ${session.appVersion}`);
  }
  parts.push(`Signed in ${formatTimestamp(session.createdAt)}`);
  return parts.join(" • ");
}

const AccountView = ({
  currentUser,
  onUserUpdate,
  onSignOut,
}: AccountViewProps) => {
  const [isEditingName, setIsEditingName] = useState(false);
  const [editName, setEditName] = useState(currentUser?.name || "");
  const [nameLoading, setNameLoading] = useState(false);
  const [sessions, setSessions] = useState<AuthSession[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [deletingSession, setDeletingSession] = useState<string | null>(null);
  const [signingOutOthers, setSigningOutOthers] = useState(false);
  const requestTokenRef = useRef<string | null>(currentUser?._id ?? null);

  useEffect(() => {
    const token = currentUser?._id ?? null;
    const changed = requestTokenRef.current !== token;
    requestTokenRef.current = token;

    if (!token || changed) {
      setSessions([]);
    }
    if (!token) {
      setSessionsLoading(false);
      return;
    }

    void loadSessions(token);
  }, [currentUser?._id]);

  useEffect(() => {
    setEditName(currentUser?.name || "");
    if (currentUser?.name?.trim()) {
      invoke("set_user_name", { name: currentUser.name.trim() }).catch((err) => {
        console.error("Failed to persist name:", err);
      });
    }
  }, [currentUser?.name]);

  if (!currentUser) {
    return null;
  }
  const userId = currentUser._id;
  const currentName = currentUser.name ?? "";

  async function loadSessions(requestToken: string) {
    setSessionsLoading(true);
    try {
      const result = await listSessions();
      if (requestTokenRef.current !== requestToken) {
        return;
      }
      setSessions(result.sessions);
    } catch (err) {
      console.error("Failed to load sessions:", err);
    } finally {
      if (requestTokenRef.current === requestToken) {
        setSessionsLoading(false);
      }
    }
  }

  async function handleSaveName() {
    const trimmedName = editName.trim();
    if (!trimmedName || trimmedName === currentName) {
      setIsEditingName(false);
      return;
    }

    setNameLoading(true);
    try {
      await updateName(trimmedName);
      await invoke("set_user_name", { name: trimmedName });
      onUserUpdate();
      setIsEditingName(false);
    } catch (err) {
      console.error("Failed to update name:", err);
    } finally {
      setNameLoading(false);
    }
  }

  async function handleDeleteSession(sessionId: string) {
    setDeletingSession(sessionId);
    try {
      await deleteSessionById(sessionId);
      setSessions((prev) => prev.filter((session) => session.id !== sessionId));
    } catch (err) {
      console.error("Failed to revoke session:", err);
    } finally {
      setDeletingSession(null);
    }
  }

  async function handleSignOutOtherSessions() {
    setSigningOutOthers(true);
    try {
      await signOutOtherSessions();
      await loadSessions(userId);
    } catch (err) {
      console.error("Failed to sign out other sessions:", err);
    } finally {
      setSigningOutOthers(false);
    }
  }

  const currentUserAvatar =
    typeof currentUser.image === "string"
      ? currentUser.image
      : typeof currentUser.prefs?.avatar === "string"
        ? currentUser.prefs.avatar
        : null;

  return (
    <div className="space-y-8">
      {/* Profile Section */}
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div className="flex items-center gap-4">
          <div className="h-14 w-14 overflow-hidden rounded-full border border-border-primary bg-surface-surface shrink-0">
            {currentUserAvatar ? (
              <img
                src={currentUserAvatar}
                alt={currentUser.name || "Profile"}
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center ui-text-title-lg font-medium ui-color-primary">
                {currentUser.name?.[0]?.toUpperCase() ||
                  currentUser.email?.[0]?.toUpperCase() ||
                  "?"}
              </div>
            )}
          </div>
          <div className="group">
            {isEditingName ? (
              <div className="flex h-[28px] items-center gap-2">
                <input
                  type="text"
                  value={editName}
                  onChange={(event) => setEditName(event.target.value)}
                  autoFocus
                  aria-label="Edit name"
                  className="h-full w-48 rounded-md border border-amber-400/50 bg-surface-elevated/30 px-2 py-0 ui-text-body-sm-strong ui-color-primary outline-none focus:border-amber-400"
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      void handleSaveName();
                    }
                    if (event.key === "Escape") {
                      setEditName(currentUser.name || "");
                      setIsEditingName(false);
                    }
                  }}
                />
                <button
                  onClick={() => void handleSaveName()}
                  disabled={nameLoading}
                  aria-label="Save name"
                  className="flex h-[28px] w-[28px] items-center justify-center rounded-md text-amber-500 transition-colors bg-surface-surface hover:bg-surface-elevated border border-border-primary"
                >
                  {nameLoading ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <Pencil size={14} aria-hidden="true" />
                  )}
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <h2 className="ui-text-title-sm font-medium ui-color-primary">
                  {currentUser.name || "Glimpse User"}
                </h2>
                <button
                  onClick={() => setIsEditingName(true)}
                  aria-label="Edit name"
                  className="rounded p-1 ui-color-muted opacity-0 transition-opacity hover:ui-color-secondary group-hover:opacity-100 focus-visible:opacity-100"
                >
                  <Pencil size={12} aria-hidden="true" />
                </button>
              </div>
            )}
            <p className="ui-text-body-sm ui-color-muted">
              {currentUser.email}
            </p>
            {(currentUser.authProviders ?? []).length > 0 ? (
              <p className="mt-0.5 ui-text-meta ui-color-disabled">
                Connected via {(currentUser.authProviders ?? []).join(" · ")}
              </p>
            ) : null}
          </div>
        </div>
        <button
          onClick={onSignOut}
          className="flex items-center justify-center gap-2 rounded-lg border border-border-primary px-4 py-2.5 ui-text-body-sm-strong ui-color-primary transition-colors bg-surface-surface hover:bg-surface-elevated/50"
        >
          <LogOut size={16} />
          Sign out
        </button>
      </div>

      {/* Active Sessions Section */}
      <div className="space-y-4">
        <header className="flex items-center justify-between">
          <div>
            <h3 className="ui-text-title-sm font-medium ui-color-primary">Active Sessions</h3>
            <p className="mt-1 ui-text-body-sm ui-color-secondary">Devices currently logged into your account.</p>
          </div>
          {sessions.some((session) => !session.current) ? (
            <button
              onClick={() => void handleSignOutOtherSessions()}
              disabled={signingOutOthers}
              className="flex items-center gap-2 rounded-lg border border-red-900/30 bg-red-900/10 px-3 py-1.5 ui-text-body-sm ui-color-primary text-red-400 hover:bg-red-900/20 transition-colors disabled:opacity-50"
            >
              {signingOutOthers && <Loader2 size={14} className="animate-spin" />}
              Sign out other devices
            </button>
          ) : null}
        </header>

        <div className="rounded-xl border border-border-primary bg-surface-surface overflow-hidden divide-y divide-border-primary">
          {sessionsLoading ? (
            <div className="flex justify-center p-8">
              <Loader2 size={24} className="animate-spin ui-color-muted" />
            </div>
          ) : sessions.length === 0 ? (
            <div className="px-6 py-8 text-center ui-text-body-sm ui-color-muted">
              No active sessions found.
            </div>
          ) : (
            sessions.map((session) => (
              <div
                key={session.id}
                className="group flex items-center justify-between p-4 transition-colors hover:bg-surface-elevated/20"
              >
                <div className="flex items-center gap-4">
                  <div className="flex size-10 items-center justify-center rounded-lg border border-border-primary bg-surface-elevated/50 ui-color-secondary">
                    {getOsIcon(session.osName, session.clientName)}
                  </div>
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <span className="ui-text-body-sm-strong ui-color-primary">
                        {session.clientName || session.deviceName || "Unknown Device"}
                      </span>
                      {session.current ? (
                        <span className="rounded-md border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[10px] uppercase font-bold text-amber-500 tracking-wider">
                          Current
                        </span>
                      ) : null}
                    </div>
                    <span className="ui-text-meta font-mono ui-color-disabled">
                      {formatSessionDetails(session)}
                    </span>
                  </div>
                </div>
                {!session.current ? (
                  <button
                    onClick={() => void handleDeleteSession(session.id)}
                    disabled={deletingSession === session.id}
                    className="flex items-center justify-center rounded-lg border border-transparent px-3 py-1.5 ui-text-body-sm font-medium ui-color-disabled opacity-0 transition-all hover:border-red-900/30 hover:bg-red-900/10 hover:text-red-400 group-hover:opacity-100 focus-visible:opacity-100 disabled:opacity-100"
                  >
                    {deletingSession === session.id ? (
                      <Loader2 size={16} className="animate-spin text-red-400" />
                    ) : (
                      "Revoke"
                    )}
                  </button>
                ) : null}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

export default AccountView;
