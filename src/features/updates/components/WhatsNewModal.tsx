import { useLingui } from "@lingui/react/macro";
import { lazy, Suspense, useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useFocusTrap } from "../../../shared/hooks/useFocusTrap";
import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  ArrowSquareOut as ExternalLink,
  CircleNotch as Loader2,
  WarningCircle as AlertCircle,
} from "@phosphor-icons/react";
import { openUrl } from "@tauri-apps/plugin-opener";

interface WhatsNewModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface ReleaseInfo {
  version: string;
  body: string;
  publishedAt: string;
  htmlUrl: string;
}

const GITHUB_REPO = "glimpse-hq/Glimpse";
const GITHUB_API_URL = `https://api.github.com/repos/${GITHUB_REPO}/releases`;
const MAX_RELEASES = 15;

const loadReleaseNotes = () => import("./ReleaseNotesMarkdown");
const ReleaseNotesMarkdown = lazy(loadReleaseNotes);

const isFeatureRelease = (version: string): boolean => {
  const match = version.match(/v?(\d+)\.(\d+)\.(\d+)/);
  if (!match) return false;
  const patch = parseInt(match[3], 10);
  return patch === 0;
};

function WhatsNewModal({ isOpen, onClose }: WhatsNewModalProps) {
  const { t, i18n } = useLingui();
  const [releases, setReleases] = useState<ReleaseInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, isOpen, onClose);

  useEffect(() => {
    if (!isOpen) return;
    // Loads alongside the releases so the notes render as soon as they arrive.
    loadReleaseNotes().catch(() => {});
    if (releases.length === 0) {
      fetchReleases();
    }
  }, [isOpen]);

  const fetchReleases = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(
        `${GITHUB_API_URL}?per_page=${MAX_RELEASES}`,
        {
          method: "GET",
          headers: {
            Accept: "application/vnd.github.v3+json",
            "User-Agent": "Glimpse-App",
          },
        },
      );
      if (!response.ok) {
        throw new Error(`Failed to fetch: ${response.status}`);
      }
      const data = (await response.json()) as Array<{
        tag_name: string;
        body: string;
        published_at: string;
        html_url: string;
        prerelease: boolean;
      }>;

      setReleases(
        data
          .filter((release) => !release.prerelease)
          .map((release) => ({
            version: release.tag_name,
            body:
              release.body ||
              t({
                id: "updates.whats_new.no_changelog",
                message: "No changelog available.",
              }),
            publishedAt: release.published_at,
            htmlUrl: release.html_url,
          })),
      );
    } catch (err) {
      console.error("Failed to fetch releases:", err);
      setError(
        t({
          id: "updates.whats_new.load_failed",
          message: "Failed to load changelog",
        }),
      );
    } finally {
      setLoading(false);
    }
  };

  const spinner = (
    <div
      role="status"
      aria-label={t({
        id: "updates.whats_new.loading",
        message: "Loading releases",
      })}
      className="flex items-center justify-center py-12"
    >
      <Loader2
        size={20}
        className="animate-spin text-content-muted"
        aria-hidden="true"
      />
    </div>
  );

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString(i18n.locale, {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="settings-typescale font-sans fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs"
          onClick={onClose}
          role="dialog"
          aria-modal="true"
          aria-labelledby="whats-new-title"
        >
          <motion.div
            ref={dialogRef}
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            transition={{ type: "spring", stiffness: 400, damping: 30 }}
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-lg h-[75vh] bg-surface-tertiary rounded-2xl border border-border-secondary shadow-2xl shadow-black/50 overflow-hidden flex flex-col"
          >
            <div className="flex items-center justify-between px-7 pt-6 pb-2 shrink-0">
              <div>
                <h2
                  id="whats-new-title"
                  className="ui-text-display font-normal ui-color-primary tracking-tight"
                >
                  {t({
                    id: "updates.whats_new.title",
                    message: "What's New",
                  })}
                </h2>
                <button
                  onClick={() => {
                    openUrl(
                      "https://github.com/glimpse-hq/Glimpse/releases",
                    ).catch((err) => {
                      console.error("Failed to open releases:", err);
                    });
                  }}
                  className="flex items-center gap-1.5 mt-1 ui-text-meta ui-color-muted hover:ui-color-secondary transition-colors"
                >
                  <span>
                    {t({
                      id: "updates.whats_new.view_all",
                      message: "View all releases on GitHub",
                    })}
                  </span>
                  <ExternalLink size={11} aria-hidden="true" />
                </button>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label={t({
                  id: "updates.whats_new.close_aria",
                  message: "Close What's New",
                })}
                className="p-1.5 rounded-md text-content-muted hover:text-content-primary hover:bg-surface-elevated transition-colors"
              >
                <X size={16} aria-hidden="true" />
              </button>
            </div>

            <div className="relative flex-1 min-h-0 overflow-hidden">
              <div
                className="pointer-events-none absolute left-0 right-3 top-0 h-6 z-10"
                style={{
                  background:
                    "linear-gradient(to bottom, var(--color-bg-tertiary), transparent)",
                }}
                aria-hidden="true"
              />
              <div
                className="pointer-events-none absolute left-0 right-3 bottom-0 h-8 z-10"
                style={{
                  background:
                    "linear-gradient(to top, var(--color-bg-tertiary), transparent)",
                }}
                aria-hidden="true"
              />
              <div className="h-full overflow-y-auto settings-scroll px-7 pt-5 pb-7">
                {(loading || releases.length === 0) && !error && spinner}

                {error && (
                  <div className="flex flex-col items-center gap-3 py-8">
                    <div
                      role="alert"
                      className="flex items-center gap-2 p-3 rounded-lg bg-red-500/10 w-full"
                    >
                      <AlertCircle
                        size={14}
                        className="ui-color-error-strong shrink-0"
                        aria-hidden="true"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="ui-text-body ui-color-error-strong font-medium">
                          {t({
                            id: "updates.whats_new.couldnt_load",
                            message: "Couldn't load releases",
                          })}
                        </p>
                        <p className="ui-text-label ui-color-error-subtle mt-0.5">
                          {t({
                            id: "updates.whats_new.github_unavailable",
                            message:
                              "GitHub may be temporarily unavailable. Check your connection and try again.",
                          })}
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={fetchReleases}
                      className="ui-text-body-sm-strong ui-color-secondary hover:text-content-primary transition-colors"
                    >
                      {t({
                        id: "updates.whats_new.retry",
                        message: "Retry",
                      })}
                    </button>
                  </div>
                )}

                {!loading && !error && releases.length > 0 && (
                  <Suspense fallback={spinner}>
                    <div className="space-y-8">
                      {releases.map((release: ReleaseInfo, index: number) => {
                        const isFeatured = isFeatureRelease(release.version);
                        return (
                          <div key={release.version || `release-${index}`}>
                            <div className="flex items-baseline gap-3 mb-1">
                              <h3
                                className={`font-semibold tracking-tight ${isFeatured ? "ui-text-title ui-color-warning-strong" : "ui-text-body-lg-strong ui-color-primary"}`}
                              >
                                {release.version}
                              </h3>
                              {isFeatured && (
                                <span className="ui-text-meta font-medium ui-color-warning">
                                  {t({
                                    id: "updates.whats_new.major_release",
                                    message: "Major Release",
                                  })}
                                </span>
                              )}
                            </div>
                            <span className="ui-text-meta ui-color-disabled">
                              {formatDate(release.publishedAt)}
                            </span>
                            <div className="mt-3">
                              <ReleaseNotesMarkdown body={release.body} />
                            </div>
                            {index < releases.length - 1 && (
                              <div className="border-t border-border-primary mt-6" />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </Suspense>
                )}
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

export default WhatsNewModal;
