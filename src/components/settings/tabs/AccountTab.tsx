import { openUrl } from "@tauri-apps/plugin-opener";
import { AnimatePresence, motion, type Variants } from "framer-motion";
import { AlertCircle, Check, Copy, Eye, EyeOff, Github, Loader2, Mail } from "lucide-react";
import { OAuthProvider } from "appwrite";
import AccountView from "../AccountView";
import DotMatrix from "../../DotMatrix";
import { getOAuth2Url, login, type User as AppwriteUser } from "../../../lib/auth";

type AccountTabProps = {
    variants: Variants;
    authError: string | null;
    authErrorCopied: boolean;
    setAuthErrorCopied: (value: boolean) => void;
    authLoading: boolean;
    currentUser: AppwriteUser | null;
    cloudSyncEnabled: boolean;
    setCloudSyncEnabled: (value: boolean) => void;
    onUpdateUser: () => Promise<void>;
    handleSignOut: () => Promise<void>;
    handleCancelAuth: () => void;
    showEmailForm: boolean;
    setShowEmailForm: (value: boolean) => void;
    authEmail: string;
    setAuthEmail: (value: string) => void;
    authPassword: string;
    setAuthPassword: (value: string) => void;
    authShowPassword: boolean;
    setAuthShowPassword: (value: boolean) => void;
    setAuthError: (value: string | null) => void;
    setAuthLoading: (value: boolean) => void;
    setPendingAuth: (value: { email: string; password: string } | null) => void;
    setShowNewAccountConfirm: (value: boolean) => void;
};

const AccountTab = ({
    variants,
    authError,
    authErrorCopied,
    setAuthErrorCopied,
    authLoading,
    currentUser,
    cloudSyncEnabled,
    setCloudSyncEnabled,
    onUpdateUser,
    handleSignOut,
    handleCancelAuth,
    showEmailForm,
    setShowEmailForm,
    authEmail,
    setAuthEmail,
    authPassword,
    setAuthPassword,
    authShowPassword,
    setAuthShowPassword,
    setAuthError,
    setAuthLoading,
    setPendingAuth,
    setShowNewAccountConfirm,
}: AccountTabProps) => (
    <motion.div
        key="account"
        variants={variants}
        initial="hidden"
        animate="visible"
        exit="exit"
        className="space-y-4"
    >
        <header>
            <h1 className="text-lg font-medium text-content-primary">Account</h1>
            <p className="mt-1 text-[12px] text-content-muted">Manage your profile, sessions, and subscription.</p>
        </header>

        {authError && (
            <div className="flex items-center gap-2 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-400">
                <AlertCopy
                    authError={authError}
                    authErrorCopied={authErrorCopied}
                    setAuthErrorCopied={setAuthErrorCopied}
                />
            </div>
        )}

        {authLoading ? (
            <div className="flex flex-col items-center justify-center py-16">
                <Loader2 size={24} className="animate-spin text-cloud mb-3" />
                <p className="text-[12px] text-content-muted mb-3">Loading...</p>
                <button
                    onClick={handleCancelAuth}
                    className="text-[11px] text-content-disabled hover:text-content-muted transition-colors"
                >
                    Cancel
                </button>
            </div>
        ) : currentUser ? (
            <AccountView
                currentUser={currentUser}
                cloudSyncEnabled={cloudSyncEnabled}
                onCloudSyncToggle={() => setCloudSyncEnabled(!cloudSyncEnabled)}
                onUserUpdate={async () => {
                    await onUpdateUser();
                    setShowEmailForm(false);
                }}
                onSignOut={handleSignOut}
            />
        ) : (
            <div className="grid grid-cols-5 gap-4">
                <div className="col-span-3 relative rounded-2xl border border-border-primary bg-surface-tertiary p-5 shadow-[0_10px_24px_rgba(0,0,0,0.28)] overflow-hidden min-h-[280px]">
                    <div className="absolute inset-0 pointer-events-none opacity-18">
                        <DotMatrix rows={8} cols={24} activeDots={[1, 4, 7, 10, 12, 15, 18, 20, 23]} dotSize={2} gap={4} color="var(--color-border-secondary)" />
                    </div>
                    <div className="relative flex flex-col h-full">
                        <div className="flex items-center gap-2 mb-3">
                            <DotMatrix rows={2} cols={2} activeDots={[0, 3]} dotSize={3} gap={2} color="var(--color-cloud)" />
                            <span className="text-[10px] font-semibold text-cloud">Glimpse Cloud</span>
                            <span className="ml-auto rounded-lg bg-surface-elevated px-2 py-0.5 text-[9px] font-medium text-content-muted">$5.99/mo</span>
                        </div>

                        <div className="flex flex-col gap-1.5 text-[11px] text-content-primary font-medium mb-4">
                            <div className="flex items-center gap-2">
                                <div className="h-1 w-3 rounded-full bg-cloud/80" />
                                <span>Cross-device sync</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <div className="h-1 w-3 rounded-full bg-cloud/80" />
                                <span>Bigger & better models</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <div className="h-1 w-3 rounded-full bg-cloud/80" />
                                <span>Faster processing</span>
                            </div>
                        </div>

                        <div className="mt-auto flex items-center gap-3 rounded-xl border border-border-primary bg-surface-tertiary px-3 py-2 text-[10px] text-content-secondary leading-relaxed">
                            <DotMatrix rows={3} cols={5} activeDots={[0, 2, 4, 6, 8, 10, 12, 14]} dotSize={2} gap={2} color="var(--color-bg-hover)" />
                            <p className="flex-1">Get faster processing, better models and cross-device sync with cloud.</p>
                        </div>
                    </div>
                </div>

                <div className="col-span-2 relative rounded-2xl border border-border-primary bg-surface-tertiary p-5 shadow-[0_10px_24px_rgba(0,0,0,0.28)] overflow-hidden min-h-[280px] flex flex-col">
                    <div className="absolute inset-0 pointer-events-none opacity-18">
                        <DotMatrix rows={8} cols={12} activeDots={[0, 3, 6, 9, 12, 15, 18, 21]} dotSize={2} gap={4} color="var(--color-border-secondary)" />
                    </div>

                    <div className="relative flex flex-col flex-1">
                        <AnimatePresence mode="wait">
                            {showEmailForm ? (
                                <motion.div
                                    key="email-form"
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    exit={{ opacity: 0, scale: 0.95 }}
                                    transition={{ duration: 0.15 }}
                                    className="relative flex flex-col h-full"
                                >
                                    <div className="flex items-center justify-between mb-3">
                                        <div className="flex items-center gap-2">
                                            <DotMatrix rows={2} cols={2} activeDots={[0, 1, 2, 3]} dotSize={3} gap={2} color="var(--color-cloud)" />
                                            <span className="text-[10px] font-semibold text-content-secondary">Continue with Email</span>
                                        </div>
                                        <button
                                            onClick={() => setShowEmailForm(false)}
                                            className="text-[9px] text-content-disabled hover:text-content-muted transition-colors"
                                        >
                                            Back
                                        </button>
                                    </div>

                                    <form
                                        onSubmit={async (e) => {
                                            e.preventDefault();
                                            setAuthError(null);
                                            setAuthLoading(true);
                                            try {
                                                await login(authEmail, authPassword);
                                                await onUpdateUser();
                                                setShowEmailForm(false);
                                            } catch (loginErr) {
                                                const errorMsg = loginErr instanceof Error ? loginErr.message : "";
                                                if (errorMsg.includes("Invalid credentials") || errorMsg.includes("user") || errorMsg.includes("not found")) {
                                                    setPendingAuth({ email: authEmail, password: authPassword });
                                                    setShowNewAccountConfirm(true);
                                                } else {
                                                    setAuthError(errorMsg || "Authentication failed");
                                                }
                                            } finally {
                                                setAuthLoading(false);
                                            }
                                        }}
                                        className="flex-1 flex flex-col gap-2"
                                    >
                                        <input
                                            type="email"
                                            placeholder="Email"
                                            value={authEmail}
                                            onChange={(e) => setAuthEmail(e.target.value)}
                                            required
                                            className="w-full rounded-lg border border-border-primary bg-surface-surface px-3 py-2 text-[11px] text-white placeholder-content-disabled outline-none focus:border-border-hover"
                                        />
                                        <div className="relative">
                                            <input
                                                type={authShowPassword ? "text" : "password"}
                                                placeholder="Password"
                                                value={authPassword}
                                                onChange={(e) => setAuthPassword(e.target.value)}
                                                required
                                                className="w-full rounded-lg border border-border-primary bg-surface-surface px-3 py-2 pr-7 text-[11px] text-white placeholder-content-disabled outline-none focus:border-border-hover"
                                            />
                                            <button
                                                type="button"
                                                onClick={() => setAuthShowPassword(!authShowPassword)}
                                                className="absolute right-2 top-1/2 -translate-y-1/2 text-content-disabled hover:text-content-muted"
                                            >
                                                {authShowPassword ? <EyeOff size={12} /> : <Eye size={12} />}
                                            </button>
                                        </div>
                                        <button
                                            type="submit"
                                            className="mt-auto rounded-lg bg-cloud py-2 text-[11px] font-semibold text-black hover:bg-cloud-light transition-colors"
                                        >
                                            Sign In
                                        </button>
                                    </form>
                                </motion.div>
                            ) : (
                                <motion.div
                                    key="account-actions"
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    exit={{ opacity: 0, scale: 0.95 }}
                                    transition={{ duration: 0.15 }}
                                    className="relative flex flex-col h-full"
                                >
                                    <div className="flex items-center gap-2 mb-3">
                                        <DotMatrix rows={2} cols={2} activeDots={[0, 1, 2, 3]} dotSize={3} gap={2} color="var(--color-cloud)" />
                                        <span className="text-[10px] font-semibold text-content-secondary">Sign in to continue</span>
                                    </div>

                                    <p className="text-[10px] text-content-muted mb-4 leading-relaxed">
                                        Sign in to sync your transcriptions across devices.
                                    </p>

                                    <div className="flex flex-col gap-2 mt-auto">
                                        <button
                                            onClick={() => {
                                                const url = getOAuth2Url(OAuthProvider.Google, window.location.href);
                                                openUrl(url);
                                            }}
                                            className="flex items-center justify-center gap-2 w-full rounded-xl border border-border-secondary bg-surface-secondary px-3 py-2.5 text-[11px] text-content-primary hover:bg-surface-surface hover:border-border-hover transition-all"
                                        >
                                            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24">
                                                <path fill="#EA4335" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                                                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                                                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                                                <path fill="#4285F4" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                                            </svg>
                                            Google
                                        </button>
                                        <button
                                            onClick={() => {
                                                const url = getOAuth2Url(OAuthProvider.Github, window.location.href);
                                                openUrl(url);
                                            }}
                                            className="flex items-center justify-center gap-2 w-full rounded-xl border border-border-secondary bg-surface-secondary px-3 py-2.5 text-[11px] text-content-primary hover:bg-surface-surface hover:border-border-hover transition-all"
                                        >
                                            <Github size={14} fill="currentColor" />
                                            GitHub
                                        </button>
                                        <button
                                            onClick={() => setShowEmailForm(true)}
                                            className="flex items-center justify-center gap-2 w-full rounded-xl border border-border-secondary bg-surface-secondary px-3 py-2.5 text-[11px] text-content-primary hover:bg-surface-surface hover:border-border-hover transition-all"
                                        >
                                            <Mail size={14} />
                                            Email
                                        </button>
                                    </div>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>
                </div>
            </div>
        )}
    </motion.div>
);

const AlertCopy = ({
    authError,
    authErrorCopied,
    setAuthErrorCopied,
}: {
    authError: string;
    authErrorCopied: boolean;
    setAuthErrorCopied: (value: boolean) => void;
}) => (
    <>
        <AlertCircle size={16} className="shrink-0" />
        <span className="flex-1">{authError}</span>
        <button
            type="button"
            onClick={() => {
                navigator.clipboard.writeText(authError);
                setAuthErrorCopied(true);
                setTimeout(() => setAuthErrorCopied(false), 1500);
            }}
            className="shrink-0 p-1 rounded hover:bg-red-500/20 transition-colors"
            title="Copy error"
        >
            {authErrorCopied ? <Check size={14} /> : <Copy size={14} />}
        </button>
    </>
);

export default AccountTab;
