import { motion, type Variants } from "framer-motion";
import { Loader2, Lock } from "lucide-react";
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
}: AccountTabProps) => {
  return (
    <motion.div
      key="account"
      variants={variants}
      initial="hidden"
      animate="visible"
      exit="exit"
      className="space-y-4"
    >
      {(authLoading || currentUser) && (
        <header>
          <h1 className="ui-text-title-lg font-medium ui-color-primary">
            Account
          </h1>
          <p className="mt-1 ui-text-body-sm ui-color-muted">
            Manage your profile, sessions, and subscription.
          </p>
        </header>
      )}

      {authLoading ? (
        <div className="flex flex-col items-center justify-center py-16">
          <Loader2 size={24} className="animate-spin ui-color-cloud mb-3" />
          <p className="ui-text-body-sm ui-color-muted mb-3">Signing in…</p>
          <button
            onClick={handleCancelAuth}
            className="ui-text-meta ui-color-disabled hover:text-content-muted transition-colors"
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
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="flex size-12 items-center justify-center rounded-full border border-border-primary bg-surface-elevated/50 mb-4">
            <Lock size={20} className="ui-color-muted" />
          </div>
          <h2 className="ui-text-title-sm font-medium ui-color-primary mb-1">
            Glimpse Cloud
          </h2>
          <p className="ui-text-body-sm ui-color-muted max-w-xs">
            Cloud features are in development.
          </p>
        </div>
      )}
    </motion.div>
  );
};

export default AccountTab;
