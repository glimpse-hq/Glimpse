import { motion, type Variants } from "framer-motion";
import { Lock, Loader2 } from "lucide-react";
import AccountView from "../AccountView";
import type { User as AuthUser } from "../../../lib/auth";

type AccountTabProps = {
    variants: Variants;
    authLoading: boolean;
    currentUser: AuthUser | null;
    cloudSyncEnabled: boolean;
    setCloudSyncEnabled: (value: boolean) => void;
    onUpdateUser: () => Promise<void>;
    handleSignOut: () => Promise<void>;
    handleCancelAuth: () => void;
};

const AccountTab = ({
    variants,
    authLoading,
    currentUser,
    cloudSyncEnabled,
    setCloudSyncEnabled,
    onUpdateUser,
    handleSignOut,
    handleCancelAuth,
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
                }}
                onSignOut={handleSignOut}
            />
        ) : (
            <div className="rounded-2xl border border-border-primary bg-surface-tertiary p-5">
                <div className="flex items-start gap-3">
                    <div className="mt-0.5 rounded-xl p-2">
                        <Lock size={16} className="text-content-secondary" />
                    </div>
                    <div className="flex-1">
                        <h2 className="text-[13px] font-semibold text-content-primary">Glimpse Cloud</h2>
                        <p className="mt-1 text-[11px] text-content-muted leading-relaxed">
                            Cloud accounts, subscriptions, and sync are currently{" "}
                            <span className="text-content-primary font-medium">in development</span>.
                        </p>
                        <div className="mt-3 text-[10px] text-content-disabled">Sign-in is disabled.</div>
                    </div>
                </div>
            </div>
        )}
    </motion.div>
);

export default AccountTab;
