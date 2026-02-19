import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { motion, AnimatePresence } from "framer-motion";
import {
    Lock,
    Loader2,
    Check,
    LogOut,
    AlertCircle,
    Pencil,
    Eye,
    EyeOff,
    X,
    Cloud,
    Copy,
    Activity,
    RefreshCw,
    Monitor,
    Smartphone
} from "lucide-react";

const AppleIcon = ({ className }: { className?: string }) => (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} height="1em" width="1em">
        <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.74 1.18 0 2.21-.89 3.12-1.13.57-.15 2.18-.09 3.3.93-2.6 1.4-1.92 5.06 1.34 6.25-.9 2.56-2.05 4.96-2.84 6.18zm-2.17-14.8c1.37-1.78 1.05-3.36 1.05-3.36s-1.35-.11-3.23 2.1c-1.43 1.57-1.16 3.16-1.16 3.16s1.6.14 3.34-1.9z" />
    </svg>
);

const WindowsIcon = ({ className }: { className?: string }) => (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} height="1em" width="1em">
        <path d="M0 3.449L9.75 2.1v9.451H0V3.449zm10.949-1.67L24 0v11.4H10.949V1.779zM0 12.6h9.75v9.451L0 20.699V12.6zm10.949 0H24v11.4l-13.051-1.83V12.6z" />
    </svg>
);

const LinuxIcon = ({ className }: { className?: string }) => (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} height="1em" width="1em">
        <path d="M12 20.125c-.273-.027-.582-.086-.777-.145-.723-.21-1.332-.777-1.605-1.492-.125-.328-.133-.426-.133-1.473V15.75l-.348-.687c-.894-1.77-1.074-2.844-.645-3.832.254-.582.434-.824 1.153-1.57 1.476-1.532 2.761-2.036 4.605-1.801.766.097 1.25.261 1.84.62 1.352.825 2.05 2.145 2.016 3.801-.027 1.426-.645 2.723-1.637 3.442l-.527.382v1.27c0 1.215-.016 1.304-.219 1.636-.312.512-1.015.825-1.777.786-.336-.016-.621-.059-.836-.125l-.234-.07-.305.21c-.496.34-1.02.438-1.57.294zm3.07-1.312c.328-.157.653-.563.805-1.012.055-.164.098-.59.098-1.734v-1.492l.48-.344c1.192-.851 1.649-2.277 1.157-3.605-.332-.903-1.254-1.684-2.223-1.883-.355-.074-1.16-.063-1.488.02-1.715.421-2.613 1.957-2.05 3.507.242.66.726 1.348 1.277 1.817l.422.363v1.64c0 1.489.02 1.579.282 1.805.27.235.805.239 1.242.016v-.098z" />
    </svg>
);

const getOsIcon = (osName: string, clientName: string) => {
    const lowerOs = osName?.toLowerCase() || "";
    const lowerClient = clientName?.toLowerCase() || "";

    if (lowerOs.includes("mac") || lowerOs.includes("darwin") || lowerOs.includes("ios")) return <AppleIcon className="text-content-secondary w-4 h-4" />;
    if (lowerOs.includes("win")) return <WindowsIcon className="text-content-secondary w-4 h-4" />;
    if (lowerOs.includes("linux") || lowerOs.includes("ubuntu") || lowerOs.includes("debian")) return <LinuxIcon className="text-content-secondary w-4 h-4" />;
    if (lowerOs.includes("android") || lowerClient.includes("phone")) return <Smartphone size={16} className="text-content-secondary" />;

    return <Monitor size={16} className="text-content-secondary" />;
};
import {
    updateName,
    updatePassword,
    listSessions,
    deleteSessionById,
    logoutAll,
    type Session as AuthSession,
    type User as AuthUser
} from "../../lib/auth";
import { getCloudUsageStats, getCachedUsageStats, type CloudUsageStats } from "../../lib";
import DotMatrix from "../DotMatrix";

interface AccountViewProps {
    currentUser: AuthUser | null;
    cloudSyncEnabled: boolean;
    onCloudSyncToggle: () => void;
    onUserUpdate: () => void;
    onSignOut: () => void;
}

const AccountView = ({
    currentUser,
    cloudSyncEnabled,
    onCloudSyncToggle,
    onUserUpdate,
    onSignOut
}: AccountViewProps) => {
    const [isEditingName, setIsEditingName] = useState(false);
    const [editName, setEditName] = useState(currentUser?.name || "");
    const [nameLoading, setNameLoading] = useState(false);

    const [showPasswordModal, setShowPasswordModal] = useState(false);
    const [currentPassword, setCurrentPassword] = useState("");
    const [newPassword, setNewPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [passwordLoading, setPasswordLoading] = useState(false);
    const [passwordError, setPasswordError] = useState<string | null>(null);
    const [passwordErrorCopied, setPasswordErrorCopied] = useState(false);
    const [passwordSuccess, setPasswordSuccess] = useState(false);
    const [showCurrentPassword, setShowCurrentPassword] = useState(false);
    const [showNewPassword, setShowNewPassword] = useState(false);

    const [sessions, setSessions] = useState<AuthSession[]>([]);
    const [sessionsLoading, setSessionsLoading] = useState(false);
    const [deletingSession, setDeletingSession] = useState<string | null>(null);

    const [usageStats, setUsageStats] = useState<CloudUsageStats>(() => {
        if (currentUser?.$id) {
            const cached = getCachedUsageStats(currentUser.$id);
            if (cached) return cached;
        }
        return {
            cloud_minutes_this_month: 0,
            cloud_hours_lifetime: 0,
            cloud_transcriptions_count: 0,
            cloud_transcriptions_this_month: 0,
        };
    });
    const [usageStatsLoading, setUsageStatsLoading] = useState(false);

    useEffect(() => {
        if (currentUser) {
            const cached = getCachedUsageStats(currentUser.$id);
            if (cached) {
                setUsageStats(cached);
            }
            loadSessions();
            loadUsageStats(false);
        }
    }, [currentUser]);

    useEffect(() => {
        setEditName(currentUser?.name || "");
        if (currentUser?.name?.trim()) {
            invoke("set_user_name", { name: currentUser.name.trim() }).catch((err) => {
                console.error("Failed to persist name:", err);
            });
        }
    }, [currentUser?.name]);

    const loadUsageStats = async (showLoading = true) => {
        if (!currentUser?.$id) return;
        if (showLoading) setUsageStatsLoading(true);
        try {
            const stats = await getCloudUsageStats(currentUser.$id);
            setUsageStats(stats);
        } catch (err) {
            console.error("Failed to load usage stats:", err);
        } finally {
            if (showLoading) setUsageStatsLoading(false);
        }
    };

    const loadSessions = async () => {
        setSessionsLoading(true);
        try {
            const result = await listSessions();
            setSessions(result.sessions);
        } catch (err) {
            console.error("Failed to load sessions:", err);
        } finally {
            setSessionsLoading(false);
        }
    };

    const handleSaveName = async () => {
        if (!editName.trim() || editName === currentUser?.name) {
            setIsEditingName(false);
            return;
        }
        setNameLoading(true);
        try {
            const trimmedName = editName.trim();
            await updateName(trimmedName);
            try {
                await invoke("set_user_name", { name: trimmedName });
            } catch (err) {
                console.error("Failed to persist name:", err);
            }
            onUserUpdate();
            setIsEditingName(false);
        } catch (err) {
            console.error("Failed to update name:", err);
        } finally {
            setNameLoading(false);
        }
    };

    const handlePasswordChange = async (e: React.FormEvent) => {
        e.preventDefault();
        setPasswordError(null);
        setPasswordSuccess(false);

        if (newPassword !== confirmPassword) {
            setPasswordError("Passwords don't match");
            return;
        }
        if (newPassword.length < 8) {
            setPasswordError("Password must be at least 8 characters");
            return;
        }

        setPasswordLoading(true);
        try {
            await updatePassword(newPassword, currentPassword);
            setPasswordSuccess(true);
            setTimeout(() => {
                closePasswordModal();
            }, 1500);
        } catch (err) {
            setPasswordError(err instanceof Error ? err.message : "Failed to update password");
        } finally {
            setPasswordLoading(false);
        }
    };

    const closePasswordModal = () => {
        setShowPasswordModal(false);
        setPasswordError(null);
        setPasswordSuccess(false);
        setCurrentPassword("");
        setNewPassword("");
        setConfirmPassword("");
        setShowCurrentPassword(false);
        setShowNewPassword(false);
    };

    const handleDeleteSession = async (sessionId: string) => {
        setDeletingSession(sessionId);
        try {
            await deleteSessionById(sessionId);
            setSessions(prev => prev.filter(s => s.$id !== sessionId));
        } catch (err) {
            console.error("Failed to delete session:", err);
        } finally {
            setDeletingSession(null);
        }
    };

    const handleSignOutAll = async () => {
        try {
            await logoutAll();
            onSignOut();
        } catch (err) {
            console.error("Failed to sign out all:", err);
        }
    };

    if (!currentUser) return null;

    const isSubscriber = currentUser.labels?.includes("cloud");

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <div className="relative">
                        <div className="h-16 w-16 rounded-full ui-gradient-avatar flex items-center justify-center border border-border-secondary shadow-lg overflow-hidden">
                            <span className="ui-text-title-lg font-medium ui-color-primary">
                                {currentUser.name?.[0]?.toUpperCase() || currentUser.email?.[0]?.toUpperCase() || "?"}
                            </span>
                        </div>
                        {isSubscriber && (
                            <div className="absolute -bottom-1 -right-1 h-6 w-6 rounded-full bg-surface-primary flex items-center justify-center p-0.5">
                                <div className="h-full w-full rounded-full bg-amber-400 flex items-center justify-center ui-color-on-warning">
                                    <Cloud size={10} strokeWidth={3} />
                                </div>
                            </div>
                        )}
                    </div>
                    <div className="group">
                        <div className="flex items-center gap-2">
                                    {isEditingName ? (
                                <div className="flex items-center gap-2 h-[28px]">
                                    <input
                                        type="text"
                                        value={editName}
                                        onChange={(e) => setEditName(e.target.value)}
                                        autoFocus
                                        aria-label="Edit name"
                                        className="bg-surface-surface border border-border-primary rounded-lg px-2 py-0 ui-text-title-lg font-medium ui-color-on-solid focus:border-amber-400/50 outline-none w-48 h-full"
                                        onKeyDown={(e) => {
                                            if (e.key === "Enter") handleSaveName();
                                            if (e.key === "Escape") {
                                                setEditName(currentUser.name || "");
                                                setIsEditingName(false);
                                            }
                                        }}
                                    />
                                    <button
                                        onClick={handleSaveName}
                                        disabled={nameLoading}
                                        aria-label="Save name"
                                        className="h-[28px] w-[28px] flex items-center justify-center rounded hover:bg-border-secondary ui-color-warning-strong"
                                    >
                                        <Check size={16} aria-hidden="true" />
                                    </button>
                                </div>
                            ) : (
                                <div className="flex items-center gap-2 h-[28px]">
                                    <h1 className="ui-text-title-lg font-medium ui-color-on-solid">
                                        {currentUser.name || "Glimpse User"}
                                    </h1>
                                    <button
                                        onClick={() => setIsEditingName(true)}
                                        aria-label="Edit name"
                                        className="opacity-0 group-hover:opacity-100 transition-opacity p-1 text-content-muted hover:text-content-secondary"
                                    >
                                        <Pencil size={12} aria-hidden="true" />
                                    </button>
                                </div>
                            )}
                        </div>
                        <p className="ui-text-body ui-color-muted mb-1.5">{currentUser.email}</p>
                        <button
                            onClick={() => setShowPasswordModal(true)}
                            className="flex items-center gap-1.5 ui-text-label ui-color-disabled hover:text-content-primary transition-colors group/pass"
                        >
                            <Lock size={10} aria-hidden="true" />
                            <span className="font-mono">••••••••</span>
                            <Pencil size={10} className="opacity-0 group-hover/pass:opacity-100 transition-opacity" aria-hidden="true" />
                            <span className="sr-only">Change password</span>
                        </button>
                    </div>
                </div>
                <button
                    onClick={onSignOut}
                    className="flex items-center gap-2 ui-text-body-sm ui-color-muted hover:text-content-primary transition-colors"
                >
                    <LogOut size={14} />
                    Sign out
                </button>
            </div>

            <div className="space-y-3">
                <h3 className="ui-text-section-label-sm ui-color-muted">Account Settings</h3>
                <div className="bg-surface-surface border border-border-primary rounded-xl overflow-hidden divide-y divide-surface-elevated">
                    <div className="flex items-center justify-between p-4 transition-colors group">
                        <div className="flex items-center gap-3">
                            <div>
                                <div className="ui-text-body-strong ui-color-primary">Subscription</div>
                                <div className="ui-text-label ui-color-muted">
                                    {isSubscriber ? "Active Cloud Plan" : "Free Plan"}
                                </div>
                            </div>
                        </div>
                        <span className="rounded-lg bg-surface-elevated px-2 py-0.5 ui-text-micro-strong ui-color-muted">
                            In development
                        </span>
                    </div>

                    <div className="flex items-center justify-between p-4 transition-colors">
                        <div className="flex items-center gap-3">
                            <div>
                                <div className={`ui-text-body-strong ${isSubscriber ? "ui-color-primary" : "ui-color-muted"}`}>History Sync</div>
                                <div className="ui-text-label ui-color-muted">
                                    {isSubscriber ? "Sync transcriptions across devices" : "Cloud feature"}
                                </div>
                            </div>
                        </div>
                        {isSubscriber ? (
                            <button
                                onClick={onCloudSyncToggle}
                                role="switch"
                                aria-checked={cloudSyncEnabled}
                                aria-label="Toggle History Sync"
                                className={`relative w-7 h-4 rounded-full transition-colors ${cloudSyncEnabled ? "bg-amber-400" : "bg-border-secondary"}`}
                            >
                                <div
                                    className={`absolute top-[2px] h-3 w-3 rounded-full bg-white shadow-sm transition-transform ${cloudSyncEnabled ? "translate-x-[14px]" : "translate-x-[2px]"}`}
                                />
                            </button>
                        ) : null}
                    </div>
                </div>
            </div>

            {/* Cloud Usage Stats Section */}
            <div className="space-y-3">
                <div className="flex items-center justify-between">
                    <h3 className="ui-text-section-label-sm ui-color-muted">Cloud Usage</h3>
                    <button
                        onClick={() => loadUsageStats(true)}
                        disabled={usageStatsLoading}
                        className={`ui-text-meta transition-colors flex items-center justify-start gap-1.5 w-[72px] mr-2 ${usageStatsLoading
                            ? "ui-color-warning-strong"
                            : "ui-color-disabled hover:text-content-primary"
                            }`}
                        title="Refresh usage stats"
                    >
                        <RefreshCw size={10} className={`flex-shrink-0 ${usageStatsLoading ? "animate-spin" : ""}`} />
                        {usageStatsLoading ? "Refreshing..." : "Refresh"}
                    </button>
                </div>
                <div className="bg-surface-surface border border-border-primary rounded-xl overflow-hidden">
                    <div className="p-4">
                        <div className="grid grid-cols-2 gap-8">
                            {/* Monthly Stats */}
                            {isSubscriber && (
                                <div className="space-y-3">
                                    <div className="flex items-center justify-between mb-2">
                                        <div className="flex items-center gap-2">
                                            <Cloud size={14} className="text-content-muted" />
                                            <span className="ui-text-body-sm-strong ui-color-primary">This Month</span>
                                        </div>
                                        <div className="text-right">
                                            <div className="ui-text-kbd ui-color-secondary leading-none mb-1">
                                                <span className="text-content-primary">{usageStats.cloud_minutes_this_month.toFixed(0)}</span>
                                                <span className="opacity-50"> / 600 min</span>
                                            </div>
                                            <div className="ui-text-micro-strong ui-color-disabled">
                                                {((usageStats.cloud_minutes_this_month / 600) * 100).toFixed(0)}% used
                                            </div>
                                        </div>
                                    </div>

                                    <UsageBar
                                        value={usageStats.cloud_minutes_this_month}
                                        max={600}
                                        color="var(--color-cloud)"
                                        cols={25}
                                        rows={4}
                                    />

                                    <div className="flex items-center gap-1.5 pt-1">
                                        <DotMatrix rows={1} cols={1} activeDots={[0]} dotSize={2} gap={1} color="var(--color-cloud)" />
                                        <span className="ui-text-meta ui-color-muted">
                                            {usageStats.cloud_transcriptions_this_month} transcriptions
                                        </span>
                                    </div>
                                </div>
                            )}

                            {/* Lifetime Stats */}
                            <div className="space-y-3">
                                <div className="flex items-center gap-2 mb-1">
                                    <Activity size={14} className="text-content-muted" />
                                    <span className="ui-text-body-sm-strong ui-color-primary">Lifetime</span>
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <div className="ui-text-stat ui-color-success leading-none mb-1">
                                            {usageStats.cloud_hours_lifetime < 1
                                                ? (usageStats.cloud_hours_lifetime * 60).toFixed(0)
                                                : usageStats.cloud_hours_lifetime.toFixed(1)
                                            }
                                            <span className="ui-text-stat-unit text-success/70 ml-1">
                                                {usageStats.cloud_hours_lifetime < 1 ? 'min' : 'hrs'}
                                            </span>
                                        </div>
                                        <div className="ui-text-meta ui-color-muted">Audio processed</div>
                                    </div>

                                    <div>
                                        <div className="ui-text-stat ui-color-primary leading-none mb-1">
                                            {usageStats.cloud_transcriptions_count}
                                        </div>
                                        <div className="ui-text-meta ui-color-muted">Transcriptions</div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <div className="space-y-3">
                <div className="flex items-center justify-between">
                    <h3 className="ui-text-section-label-sm ui-color-muted">Active Sessions</h3>
                    {sessions.length > 1 && (
                        <button
                            onClick={handleSignOutAll}
                            className="ui-text-meta ui-color-error-strong ui-hover-error-soft transition-colors"
                        >
                            Sign out all devices
                        </button>
                    )}
                </div>

                <div className="bg-surface-surface border border-border-primary rounded-xl overflow-hidden divide-y divide-surface-elevated">
                    {sessionsLoading ? (
                        <div className="p-8 flex justify-center">
                            <Loader2 size={18} className="animate-spin text-content-disabled" />
                        </div>
                    ) : (
                        sessions.map((session) => (
                            <div key={session.$id} className="flex items-center justify-between p-4 hover:bg-surface-elevated transition-colors group">
                                <div className="flex items-center gap-3">
                                    {getOsIcon(session.osName, session.clientName)}
                                    <div className="flex flex-col">
                                        <div className="flex items-center gap-2">
                                            <span className="ui-text-body-strong ui-color-primary">
                                                {session.clientName || "Unknown Device"}
                                            </span>
                                            {session.current && (
                                                <span className="ui-text-micro font-semibold ui-color-warning-strong bg-amber-400/10 px-1.5 py-0.5 rounded">
                                                    Current
                                                </span>
                                            )}
                                        </div>
                                        <span className="ui-text-label ui-color-muted">
                                            {session.osName}, {session.countryName || "Unknown Location"}
                                        </span>
                                    </div>
                                </div>
                                {!session.current && (
                                    <button
                                        onClick={() => handleDeleteSession(session.$id)}
                                        disabled={deletingSession === session.$id}
                                        className="ui-text-button ui-color-disabled ui-hover-error-strong transition-colors px-2 py-1 opacity-0 group-hover:opacity-100 disabled:opacity-100"
                                    >
                                        {deletingSession === session.$id ? (
                                            <Loader2 size={12} className="animate-spin ui-color-error-strong" />
                                        ) : (
                                            "Revoke"
                                        )}
                                    </button>
                                )}
                            </div>
                        ))
                    )}
                </div>
            </div>

            <AnimatePresence>
                {showPasswordModal && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
                        onClick={closePasswordModal}
                    >
                        <motion.div
                            initial={{ opacity: 0, scale: 0.95, y: 10 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.95, y: 10 }}
                            onClick={(e) => e.stopPropagation()}
                            className="w-[380px] rounded-2xl border border-border-primary bg-surface-tertiary p-6 shadow-2xl"
                        >
                            <div className="flex items-center justify-between mb-6">
                                <h3 className="ui-text-title font-medium ui-color-on-solid">Change Password</h3>
                                <button
                                    onClick={closePasswordModal}
                                    className="p-1 rounded-lg hover:bg-surface-elevated text-content-disabled ui-hover-on-solid transition-colors"
                                >
                                    <X size={16} />
                                </button>
                            </div>

                            {passwordSuccess ? (
                                <div className="flex flex-col items-center py-6 animate-in fade-in zoom-in duration-300">
                                    <div className="h-12 w-12 rounded-full bg-emerald-500/10 flex items-center justify-center mb-3">
                                        <Check size={20} className="ui-color-success-strong" />
                                    </div>
                                    <p className="ui-text-body ui-color-primary">Password updated successfully</p>
                                </div>
                            ) : (
                                <form onSubmit={handlePasswordChange} className="space-y-4">
                                    {passwordError && (
                                        <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg flex items-center gap-2 ui-color-error-tint ui-text-label">
                                            <AlertCircle size={12} className="shrink-0" />
                                            <span className="flex-1">{passwordError}</span>
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    navigator.clipboard.writeText(passwordError);
                                                    setPasswordErrorCopied(true);
                                                    setTimeout(() => setPasswordErrorCopied(false), 1500);
                                                }}
                                                className="shrink-0 p-0.5 rounded hover:bg-red-500/20 transition-colors"
                                                title="Copy error"
                                            >
                                                {passwordErrorCopied ? <Check size={11} /> : <Copy size={11} />}
                                            </button>
                                        </div>
                                    )}

                                    <div className="space-y-3">
                                        <div>
                                            <div className="relative">
                                                <input
                                                    type={showCurrentPassword ? "text" : "password"}
                                                    value={currentPassword}
                                                    onChange={(e) => setCurrentPassword(e.target.value)}
                                                    placeholder="Current password"
                                                    aria-label="Current password"
                                                    className="w-full bg-surface-surface border border-border-secondary rounded-xl px-4 py-2.5 ui-text-body ui-color-on-solid placeholder-content-disabled focus:border-content-disabled outline-none transition-colors"
                                                />
                                                <button
                                                    type="button"
                                                    onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                                                    className="absolute right-3 top-2.5 text-content-disabled hover:text-content-secondary"
                                                    aria-label={showCurrentPassword ? "Hide password" : "Show password"}
                                                >
                                                    {showCurrentPassword ? <EyeOff size={14} aria-hidden="true" /> : <Eye size={14} aria-hidden="true" />}
                                                </button>
                                            </div>
                                        </div>

                                        <div>
                                            <div className="relative">
                                                <input
                                                    type={showNewPassword ? "text" : "password"}
                                                    value={newPassword}
                                                    onChange={(e) => setNewPassword(e.target.value)}
                                                    placeholder="New password"
                                                    aria-label="New password"
                                                    className="w-full bg-surface-surface border border-border-secondary rounded-xl px-4 py-2.5 ui-text-body ui-color-on-solid placeholder-content-disabled focus:border-content-disabled outline-none transition-colors"
                                                />
                                                <button
                                                    type="button"
                                                    onClick={() => setShowNewPassword(!showNewPassword)}
                                                    className="absolute right-3 top-2.5 text-content-disabled hover:text-content-secondary"
                                                    aria-label={showNewPassword ? "Hide password" : "Show password"}
                                                >
                                                    {showNewPassword ? <EyeOff size={14} aria-hidden="true" /> : <Eye size={14} aria-hidden="true" />}
                                                </button>
                                            </div>
                                        </div>

                                        <div>
                                            <input
                                                type="password"
                                                value={confirmPassword}
                                                onChange={(e) => setConfirmPassword(e.target.value)}
                                                placeholder="Confirm new password"
                                                aria-label="Confirm new password"
                                                className="w-full bg-surface-surface border border-border-secondary rounded-xl px-4 py-2.5 ui-text-body ui-color-on-solid placeholder-content-disabled focus:border-content-disabled outline-none transition-colors"
                                            />
                                        </div>
                                    </div>

                                    <button
                                        type="submit"
                                        disabled={passwordLoading}
                                        className="w-full bg-content-primary hover:bg-white ui-color-on-warning font-medium rounded-xl py-2.5 ui-text-body transition-colors disabled:opacity-50 mt-2"
                                    >
                                        {passwordLoading ? (
                                            <Loader2 size={14} className="animate-spin mx-auto" />
                                        ) : (
                                            "Save and Update"
                                        )}
                                    </button>
                                </form>
                            )}
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};



const UsageBar = ({ value, max, color, cols = 40, rows = 2 }: { value: number; max: number; color: string; cols?: number; rows?: number }) => {
    const totalDots = cols * rows;
    const percent = Math.min(100, (value / max) * 100);
    const activeCount = Math.round((percent / 100) * totalDots);

    const activeDots = [];
    for (let i = 0; i < activeCount && i < totalDots; i++) {
        activeDots.push(i);
    }

    return (
        <DotMatrix
            rows={rows}
            cols={cols}
            activeDots={activeDots}
            dotSize={3}
            gap={2}
            color={color}
            className="opacity-70"
        />
    );
};

export default AccountView;
