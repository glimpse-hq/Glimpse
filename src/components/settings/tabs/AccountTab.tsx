import { motion, type Variants } from "framer-motion";
import { Check, Github, Loader2 } from "lucide-react";
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
  handleSignIn: (provider: string, params?: Record<string, unknown>) => Promise<void>;
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
  handleSignIn,
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
          <h1 className="ui-text-title-lg font-medium ui-color-primary">Account</h1>
          <p className="mt-1 ui-text-body-sm ui-color-muted">Manage your profile, sessions, and subscription.</p>
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
        <div className="space-y-8">
          {/* Cloud Processing Section */}
          <div className="space-y-4">
            <header>
              <h2 className="ui-text-title-lg font-medium ui-color-primary">
                Cloud Processing
              </h2>
              <p className="mt-1 ui-text-body-sm ui-color-secondary">
                Offload transcription to the cloud. Pay as you go, with no expiration.
              </p>
            </header>

            <div className="rounded-xl border border-border-primary bg-surface-surface overflow-hidden divide-y divide-border-primary">
              <div className="p-4 bg-surface-elevated/30 flex flex-col sm:flex-row gap-4 sm:gap-6">
                <div className="flex flex-1 items-center justify-between sm:block sm:space-y-1">
                  <span className="ui-text-body-sm ui-color-primary block">Starter</span>
                  <span className="ui-text-body-sm font-mono ui-color-primary font-medium block">$10 <span className="ui-color-secondary font-normal ml-1">/ 20h</span></span>
                </div>
                <div className="hidden sm:block w-px bg-border-primary my-1" />
                <div className="flex flex-1 items-center justify-between sm:block sm:space-y-1">
                  <span className="ui-text-body-sm ui-color-warning block">Standard (Recommended)</span>
                  <span className="ui-text-body-sm font-mono ui-color-warning font-medium block">$25 <span className="opacity-90 font-normal ml-1">/ 50h</span></span>
                </div>
                <div className="hidden sm:block w-px bg-border-primary my-1" />
                <div className="flex flex-1 items-center justify-between sm:block sm:space-y-1">
                  <span className="ui-text-body-sm ui-color-primary block">Power</span>
                  <span className="ui-text-body-sm font-mono ui-color-primary font-medium block">$50 <span className="ui-color-secondary font-normal ml-1">/ 125h</span></span>
                </div>
              </div>

              <div className="p-4 flex items-center gap-2">
                <Check size={14} className="ui-color-primary flex-shrink-0" />
                <span className="ui-text-body-sm ui-color-primary">Includes seamless cross-device history sync</span>
              </div>
              <div className="px-4 py-3 bg-surface-elevated/30">
                <p className="ui-text-meta ui-color-muted text-center sm:text-left">
                  Credits can be purchased after signing in.
                </p>
              </div>
            </div>
          </div>

          {/* Sign In Section */}
          <div className="space-y-4">
            <header>
              <h3 className="ui-text-title-sm font-medium ui-color-primary">Sign In</h3>
              <p className="mt-1 ui-text-body-sm ui-color-secondary">
                Connect an account to access cloud features.
              </p>
            </header>

            <div className="flex flex-wrap gap-3">
              <button
                onClick={() => handleSignIn("google")}
                className="flex items-center gap-3 px-4 py-2.5 rounded-lg border border-border-primary bg-surface-surface hover:bg-surface-elevated/50 transition-colors"
              >
                <div className="flex size-5 items-center justify-center shrink-0">
                  <svg className="w-4 h-4" viewBox="0 0 24 24">
                    <path fill="#EA4335" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                    <path fill="#4285F4" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                  </svg>
                </div>
                <span className="ui-text-body-sm-strong ui-color-primary">Continue with Google</span>
              </button>
              <button
                onClick={() => handleSignIn("github")}
                className="flex items-center gap-3 px-4 py-2.5 rounded-lg border border-border-primary bg-surface-surface hover:bg-surface-elevated/50 transition-colors"
              >
                <div className="flex size-5 items-center justify-center shrink-0">
                  <Github size={16} className="ui-color-primary" />
                </div>
                <span className="ui-text-body-sm-strong ui-color-primary">Continue with GitHub</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </motion.div>
  );
};

export default AccountTab;
