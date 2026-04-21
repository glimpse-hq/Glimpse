import { useLingui } from "@lingui/react/macro";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { invoke } from "@tauri-apps/api/core";
import { Plus } from "lucide-react";
import { useShiftHeld } from "../../../shared/hooks/useShiftHeld";
import ToggleSwitch from "../../../shared/ui/ToggleSwitch";
import DotMatrix from "../../../shared/ui/DotMatrix";
import type { Personality } from "../../../types";
import {
  buildWebsiteIconMap,
  createId,
  formatWebsitePreview,
  normalizeWebsite,
  type InstalledApp,
  type WebsiteIcon,
} from "./personalization-utils";
import PersonalityModal, {
  AppIconBadge,
  WebsiteFavicon,
  type PendingDeletePersonality,
} from "./PersonalityModal";

const PersonalizationView = ({ isActive = true }: { isActive?: boolean }) => {
  const { t } = useLingui();
  const [personalities, setPersonalities] = useState<Personality[]>([]);
  const [installedApps, setInstalledApps] = useState<InstalledApp[]>([]);
  const [websiteIconBySite, setWebsiteIconBySite] = useState<
    Record<string, string>
  >({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activePersonalityId, setActivePersonalityId] = useState<string | null>(
    null,
  );
  const [pendingDeletePersonality, setPendingDeletePersonality] =
    useState<PendingDeletePersonality | null>(null);
  const hasRequestedIconRefreshRef = useRef(false);
  const websiteIconRefreshKeyRef = useRef<string | null>(null);
  const persistVersionRef = useRef(0);
  const saveTimeoutRef = useRef<number | null>(null);
  const shiftHeld = useShiftHeld(isActive);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [personalityResp, appsResp] = await Promise.all([
        invoke<Personality[]>("get_personalities"),
        invoke<InstalledApp[]>("list_installed_apps"),
      ]);
      setPersonalities(personalityResp ?? []);
      setInstalledApps(appsResp ?? []);
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isActive) return;
    load();
  }, [isActive, load]);

  const websiteDomains = useMemo(() => {
    const seen = new Set<string>();
    for (const personality of personalities) {
      for (const site of personality.websites) {
        const normalized = normalizeWebsite(site);
        if (normalized) {
          seen.add(normalized);
        }
      }
    }
    return Array.from(seen).sort();
  }, [personalities]);

  const loadWebsiteIcons = useCallback(async (sites: string[]) => {
    if (sites.length === 0) {
      setWebsiteIconBySite({});
      return;
    }
    try {
      const iconsResp = await invoke<WebsiteIcon[]>("list_website_icons", {
        sites,
      });
      setWebsiteIconBySite(buildWebsiteIconMap(iconsResp ?? []));
    } catch (err) {
      console.error(err);
    }
  }, []);

  useEffect(() => {
    if (!isActive) return;
    void loadWebsiteIcons(websiteDomains);
  }, [isActive, websiteDomains, loadWebsiteIcons]);

  useEffect(() => {
    if (!isActive) return;

    if (websiteDomains.length === 0) {
      websiteIconRefreshKeyRef.current = null;
      return;
    }

    const hasMissingIcons = websiteDomains.some(
      (site) => !websiteIconBySite[site],
    );
    if (!hasMissingIcons) {
      websiteIconRefreshKeyRef.current = websiteDomains.join("|");
      return;
    }

    const currentKey = websiteDomains.join("|");
    if (websiteIconRefreshKeyRef.current === currentKey) {
      return;
    }

    const timer = window.setTimeout(async () => {
      websiteIconRefreshKeyRef.current = currentKey;
      try {
        const iconsResp = await invoke<WebsiteIcon[]>("list_website_icons", {
          sites: websiteDomains,
        });
        setWebsiteIconBySite(buildWebsiteIconMap(iconsResp ?? []));
      } catch {
        // Keep current icon map; website icon refresh is best-effort only.
      }
    }, 2500);

    return () => {
      window.clearTimeout(timer);
    };
  }, [isActive, websiteDomains, websiteIconBySite]);

  useEffect(() => {
    if (!isActive) return;

    if (
      hasRequestedIconRefreshRef.current ||
      loading ||
      installedApps.length === 0
    ) {
      return;
    }

    const hasMissingIcons = installedApps.some((app) => !app.icon_path);
    if (!hasMissingIcons) {
      hasRequestedIconRefreshRef.current = true;
      return;
    }

    const timer = window.setTimeout(async () => {
      hasRequestedIconRefreshRef.current = true;
      try {
        const appsResp = await invoke<InstalledApp[]>("list_installed_apps");
        setInstalledApps(appsResp ?? []);
      } catch {
        // Keep current app list; icon refresh is best-effort only.
      }
    }, 2500);

    return () => {
      window.clearTimeout(timer);
    };
  }, [isActive, installedApps, loading]);

  const persistPersonalities = useCallback((next: Personality[]) => {
    const persistVersion = persistVersionRef.current + 1;
    persistVersionRef.current = persistVersion;
    
    if (saveTimeoutRef.current !== null) {
      window.clearTimeout(saveTimeoutRef.current);
    }
    
    saveTimeoutRef.current = window.setTimeout(async () => {
      setError(null);
      try {
        const cleaned = await invoke<Personality[]>("set_personalities", {
          personalities: next,
        });
        if (persistVersion !== persistVersionRef.current) {
          return;
        }
        setPersonalities(cleaned ?? next);
      } catch (err) {
        if (persistVersion !== persistVersionRef.current) {
          return;
        }
        console.error(err);
        setError(err instanceof Error ? err.message : String(err));
      }
    }, 500);
  }, []);

  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current !== null) {
        window.clearTimeout(saveTimeoutRef.current);
      }
    };
  }, []);

  const updatePersonalities = useCallback(
    (updater: (prev: Personality[]) => Personality[]) => {
      setPersonalities((prev) => {
        const next = updater(prev);
        void persistPersonalities(next);
        return next;
      });
    },
    [persistPersonalities],
  );

  const updatePersonality = useCallback(
    (id: string, patch: Partial<Personality>) => {
      updatePersonalities((prev) =>
        prev.map((personality) =>
          personality.id === id ? { ...personality, ...patch } : personality,
        ),
      );
    },
    [updatePersonalities],
  );

  const updatePersonalityList = useCallback(
    (id: string, updater: (current: Personality) => Personality) => {
      updatePersonalities((prev) =>
        prev.map((personality) =>
          personality.id === id ? updater(personality) : personality,
        ),
      );
    },
    [updatePersonalities],
  );

  const handleAddMode = () => {
    const id = createId();
    const nextMode: Personality = {
      id,
      name: t({
        id: "personalization.new_mode.default_name",
        message: "New Mode",
      }),
      enabled: true,
      apps: [],
      websites: [],
      instructions: [],
    };
    updatePersonalities((prev) => [...prev, nextMode]);
    setActivePersonalityId(id);
  };

  const handleDeleteMode = useCallback(
    (id: string) => {
      updatePersonalities((prev) => prev.filter((mode) => mode.id !== id));
      setActivePersonalityId(null);
    },
    [updatePersonalities],
  );

  const requestDeleteModeConfirm = useCallback((personality: Personality) => {
    setPendingDeletePersonality({ id: personality.id, name: personality.name });
  }, []);

  const confirmDeleteMode = useCallback(() => {
    if (!pendingDeletePersonality) {
      return;
    }
    const targetId = pendingDeletePersonality.id;
    setPendingDeletePersonality(null);
    handleDeleteMode(targetId);
  }, [pendingDeletePersonality, handleDeleteMode]);

  const activePersonality = useMemo(() => {
    return (
      personalities.find(
        (personality) => personality.id === activePersonalityId,
      ) || null
    );
  }, [personalities, activePersonalityId]);

  const installedAppByName = useMemo(() => {
    const entries = installedApps.map(
      (app) => [app.name.toLowerCase(), app] as const,
    );
    return new Map(entries);
  }, [installedApps]);

  useEffect(() => {
    if (activePersonalityId && !activePersonality) {
      setActivePersonalityId(null);
    }
  }, [activePersonalityId, activePersonality]);

  useEffect(() => {
    if (!isActive) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.key !== "Escape") {
        return;
      }

      if (pendingDeletePersonality) {
        event.preventDefault();
        setPendingDeletePersonality(null);
        return;
      }

      if (activePersonalityId) {
        event.preventDefault();
        setActivePersonalityId(null);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activePersonalityId, isActive, pendingDeletePersonality]);

  return (
    <div className="w-full text-left max-w-7xl mx-auto px-0">
      <div className="flex items-start gap-3 mb-6 mt-2 md:-mt-6">
        <DotMatrix
          rows={2}
          cols={3}
          activeDots={[0, 1, 4, 5]}
          dotSize={3}
          gap={3}
          color="var(--color-section-marker-alt)"
        />
        <div className="flex-1 flex items-start justify-between gap-4">
          <div>
            <p className="ui-text-screen-title ui-color-primary tracking-tight">
              {t({
                id: "personalization.title",
                message: "Personalization",
              })}
            </p>
            <p className="mt-1 ui-text-body-sm ui-color-secondary">
              {t({
                id: "personalization.description",
                message: "Tailor language model behavior to apps, sites, and custom instructions.",
              })}
            </p>
          </div>
          <button
            type="button"
            onClick={handleAddMode}
            aria-label={t({
              id: "personalization.new_mode",
              message: "New mode",
            })}
            className="group inline-flex shrink-0 self-start items-center gap-1.5 rounded-lg border border-border-primary bg-surface-secondary px-3 py-1.5 ui-text-button ui-color-secondary transition-colors hover:border-border-hover hover:bg-surface-elevated hover:text-content-primary"
          >
            <Plus
              size={13}
              aria-hidden="true"
              className="text-content-muted transition-colors group-hover:text-content-primary"
            />
            {t({
              id: "personalization.new_mode",
              message: "New mode",
            })}
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <DotMatrix
            rows={2}
            cols={6}
            activeDots={[0, 1, 2, 3, 4, 5]}
            dotSize={3}
            gap={3}
            color="var(--color-content-muted)"
            animated
            className="opacity-60"
          />
        </div>
      ) : personalities.length === 0 ? (
        <div className="rounded-xl border border-border-primary bg-surface-secondary px-6 py-8 ui-color-muted">
          <p className="ui-text-body-lg-strong">
            {t({
              id: "personalization.empty.title",
              message: "No modes yet",
            })}
          </p>
          <p className="ui-text-body-sm ui-color-muted">
            {t({
              id: "personalization.empty.description",
              message: "Create a mode to start customizing your apps and websites.",
            })}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2">
          {personalities.map((personality, index) => {
            const appsPreview = personality.apps.slice(0, 3);
            const sitesPreview = personality.websites.slice(0, 2);
            const moreApps = Math.max(
              0,
              personality.apps.length - appsPreview.length,
            );
            const moreSites = Math.max(
              0,
              personality.websites.length - sitesPreview.length,
            );
            return (
              <div
                key={personality.id || `personality-${index}`}
                onClick={() => {
                  if (shiftHeld) {
                    requestDeleteModeConfirm(personality);
                    return;
                  }
                  setActivePersonalityId(personality.id);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    if (shiftHeld) {
                      requestDeleteModeConfirm(personality);
                      return;
                    }
                    setActivePersonalityId(personality.id);
                  }
                }}
                role="button"
                tabIndex={0}
                className={`ui-card-liftable group relative p-2.5 text-left ${
                  shiftHeld
                    ? "!border-red-500/30 hover:!border-red-500/60 hover:!bg-red-500/5"
                    : ""
                }`}
              >
                <div className="relative space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="ui-text-body-lg-strong ui-color-primary">
                        {personality.name}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <div onClick={(event) => event.stopPropagation()}>
                        <ToggleSwitch
                          enabled={personality.enabled}
                          onToggle={() =>
                            updatePersonality(personality.id, {
                              enabled: !personality.enabled,
                            })
                          }
                          ariaLabel={
                            personality.enabled
                              ? t({
                                  id: "personalization.disable_mode",
                                  message: "Disable mode",
                                })
                              : t({
                                  id: "personalization.enable_mode",
                                  message: "Enable mode",
                                })
                          }
                        />
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <p className="ui-text-uppercase-micro ui-color-disabled">
                        {t({
                          id: "personalization.apps",
                          message: "Apps",
                        })}
                      </p>
                      <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
                        {appsPreview.length === 0 ? (
                          <span className="ui-text-meta ui-color-disabled">
                            {t({
                              id: "personalization.no_apps",
                              message: "No apps yet",
                            })}
                          </span>
                        ) : (
                          appsPreview.map((app, index) => (
                            <div
                              key={`app-preview-${index}-${app || "empty"}`}
                              title={app}
                            >
                              <AppIconBadge
                                appName={app}
                                iconPath={
                                  installedAppByName.get(app.toLowerCase())
                                    ?.icon_path
                                }
                                size="chip"
                              />
                            </div>
                          ))
                        )}
                        {moreApps > 0 && (
                          <span className="ui-text-meta font-mono ui-color-muted">
                            +{moreApps}
                          </span>
                        )}
                      </div>
                    </div>

                    <div>
                      <p className="ui-text-uppercase-micro ui-color-disabled">
                        {t({
                          id: "personalization.websites",
                          message: "Websites",
                        })}
                      </p>
                      <div className="mt-1.5 flex items-center gap-1.5 min-w-0 flex-nowrap">
                        {sitesPreview.length === 0 ? (
                          <span className="ui-text-meta ui-color-disabled">
                            {t({
                              id: "personalization.no_sites",
                              message: "No sites yet",
                            })}
                          </span>
                        ) : (
                          sitesPreview.map((site, index) => (
                            <span
                              key={`site-preview-${index}-${site || "empty"}`}
                              className="min-w-0 max-w-[118px] rounded-md border border-border-primary bg-surface-overlay px-2 py-1 ui-text-micro ui-color-secondary inline-flex items-center gap-1"
                            >
                              <WebsiteFavicon
                                site={site}
                                iconPath={
                                  websiteIconBySite[normalizeWebsite(site)]
                                }
                                size="chip"
                              />
                              <span className="min-w-0 truncate font-mono">
                                {formatWebsitePreview(site)}
                              </span>
                            </span>
                          ))
                        )}
                        {moreSites > 0 && (
                          <span className="shrink-0 ui-text-meta font-mono ui-color-muted">
                            +{moreSites}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="mt-2 pt-2 border-t border-border-primary ui-text-meta ui-color-muted flex items-center gap-2 min-w-0">
                    <span className="ui-text-uppercase-micro ui-color-disabled">
                      {t({
                        id: "personalization.notes",
                        message: "Notes:",
                      })}
                    </span>
                    <span className="font-mono truncate flex-1">
                      {personality.instructions.length > 0
                        ? personality.instructions[0]
                        : t({
                            id: "personalization.no_notes",
                            message: "No notes yet",
                          })}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {error && (
        <div className="mt-4 ui-text-body-sm ui-color-error-soft">{error}</div>
      )}

      {activePersonality && (
        <PersonalityModal
          personality={activePersonality}
          installedApps={installedApps}
          websiteIconBySite={websiteIconBySite}
          onClose={() => setActivePersonalityId(null)}
          onUpdate={(patch) => updatePersonality(activePersonality.id, patch)}
          onUpdateList={(updater) =>
            updatePersonalityList(activePersonality.id, updater)
          }
          onDelete={() => requestDeleteModeConfirm(activePersonality)}
        />
      )}

      <AnimatePresence>
        {pendingDeletePersonality && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-xs"
            onClick={() => setPendingDeletePersonality(null)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 14 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 14 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              onClick={(event) => event.stopPropagation()}
              className="w-[380px] max-w-[92vw] rounded-2xl border border-border-secondary bg-surface-overlay p-5 shadow-2xl"
              role="dialog"
              aria-modal="true"
              aria-labelledby="delete-mode-title"
            >
              <h3
                id="delete-mode-title"
                className="ui-text-title-strong ui-color-primary"
              >
                {t({
                  id: "personalization.delete_mode.title",
                  message: "Delete mode?",
                })}
              </h3>
              <p className="mt-2 ui-text-body-sm ui-color-secondary">
                {t({
                  id: "personalization.delete_mode.description",
                  message: `Delete "${pendingDeletePersonality.name}"? This cannot be undone.`,
                })}
              </p>
              <div className="mt-4 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setPendingDeletePersonality(null)}
                  className="rounded-lg border border-border-primary bg-surface-surface px-3 py-1.5 ui-text-button ui-color-primary hover:bg-surface-elevated transition-colors"
                >
                  {t({
                    id: "personalization.cancel",
                    message: "Cancel",
                  })}
                </button>
                <button
                  type="button"
                  onClick={confirmDeleteMode}
                  className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-1.5 ui-text-button font-semibold ui-color-error-soft hover:bg-red-500/15 transition-colors"
                >
                  {t({
                    id: "personalization.delete",
                    message: "Delete",
                  })}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default PersonalizationView;
