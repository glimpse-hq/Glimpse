import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { convertFileSrc } from "@tauri-apps/api/core";
import { Check, Pencil, Plus, Trash2, X } from "lucide-react";
import DotMatrix from "../../../shared/ui/DotMatrix";
import { Dropdown } from "../../../shared/ui/Dropdown";
import type { Personality } from "../../../types";
import {
  clampInstructionsHeight,
  clampInstructionsText,
  countInstructionsChars,
  DEFAULT_INSTRUCTIONS_HEIGHT,
  getInitials,
  getWebsiteFallback,
  isValidDomain,
  MAX_INSTRUCTIONS_CHARS,
  normalizeEntry,
  normalizeWebsite,
  type InstalledApp,
} from "./personalization-utils";

export type PendingDeletePersonality = {
  id: string;
  name: string;
};

type AppIconBadgeProps = {
  appName: string;
  iconPath?: string | null;
  size?: "chip" | "list" | "option";
};

const AppIconBadge = ({
  appName,
  iconPath,
  size = "chip",
}: AppIconBadgeProps) => {
  const iconUrl = iconPath ? convertFileSrc(iconPath) : null;
  const sizeClass = size === "chip" ? "h-7 w-7" : "h-[18px] w-[18px]";
  const textClass =
    size === "chip" ? "ui-text-micro" : "text-[9px] leading-none";
  const baseClass = `${sizeClass} shrink-0 flex items-center justify-center`;

  if (iconUrl) {
    return (
      <span className={`${baseClass} overflow-hidden`} aria-hidden="true">
        <img
          src={iconUrl}
          alt=""
          className="h-full w-full object-cover rounded-md scale-110"
          loading="lazy"
        />
      </span>
    );
  }

  return (
    <span
      className={`${baseClass} rounded-md border border-border-secondary bg-surface-overlay ui-color-secondary`}
      aria-hidden="true"
    >
      <span className={`${textClass} font-semibold`}>
        {getInitials(appName)}
      </span>
    </span>
  );
};

type WebsiteFaviconProps = {
  site: string;
  iconPath?: string | null;
  size?: "chip" | "list";
};

const WebsiteFavicon = ({
  site,
  iconPath,
  size = "chip",
}: WebsiteFaviconProps) => {
  const sizeClass = size === "chip" ? "h-3.5 w-3.5" : "h-4 w-4";
  const fallbackTextClass = size === "chip" ? "text-[8px]" : "text-[9px]";
  if (!iconPath) {
    return (
      <span
        className={`${sizeClass} shrink-0 rounded-sm border border-border-secondary bg-surface-overlay flex items-center justify-center ui-color-secondary ${fallbackTextClass}`}
        aria-hidden="true"
      >
        {getWebsiteFallback(site)}
      </span>
    );
  }

  return (
    <img
      src={convertFileSrc(iconPath)}
      alt=""
      className={`${sizeClass} shrink-0 rounded-sm`}
      loading="lazy"
      aria-hidden="true"
    />
  );
};

export { AppIconBadge, WebsiteFavicon };

type PersonalityModalProps = {
  personality: Personality;
  installedApps: InstalledApp[];
  websiteIconBySite: Record<string, string>;
  onClose: () => void;
  onUpdate: (patch: Partial<Personality>) => void;
  onUpdateList: (updater: (current: Personality) => Personality) => void;
  onDelete: () => void;
};

const PersonalityModal = ({
  personality,
  installedApps,
  websiteIconBySite,
  onClose,
  onUpdate,
  onUpdateList,
  onDelete,
}: PersonalityModalProps) => {
  const nameInputRef = useRef<HTMLInputElement>(null);
  const [isEditingName, setIsEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(personality.name);
  const [selectedAppOption, setSelectedAppOption] = useState<string | null>(
    null,
  );
  const [websiteInput, setWebsiteInput] = useState("");
  const [websiteError, setWebsiteError] = useState<string | null>(null);
  const [instructionsText, setInstructionsText] = useState("");
  const [instructionsHeight, setInstructionsHeight] = useState(
    DEFAULT_INSTRUCTIONS_HEIGHT,
  );
  const [isResizingInstructions, setIsResizingInstructions] = useState(false);
  const resizeStartYRef = useRef(0);
  const resizeStartHeightRef = useRef(DEFAULT_INSTRUCTIONS_HEIGHT);

  useEffect(() => {
    setNameDraft(personality.name);
    setIsEditingName(false);
    setSelectedAppOption(null);
    setWebsiteInput("");
    setWebsiteError(null);
    setInstructionsText(
      clampInstructionsText(personality.instructions.join("\n")),
    );
    setInstructionsHeight(DEFAULT_INSTRUCTIONS_HEIGHT);
  }, [personality.id]);

  const commitName = () => {
    const value = normalizeEntry(nameDraft);
    if (!value) {
      setNameDraft(personality.name);
      return;
    }
    if (value !== personality.name) {
      onUpdate({ name: value });
    }
  };

  const appOptions = useMemo(() => {
    const seen = new Set<string>();
    return installedApps.filter((app) => {
      const key = app.name.toLowerCase();
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }, [installedApps]);

  const installedAppByName = useMemo(() => {
    return new Map(appOptions.map((app) => [app.name.toLowerCase(), app]));
  }, [appOptions]);

  const installedNameSet = useMemo(() => {
    return new Set(installedAppByName.keys());
  }, [installedAppByName]);

  const appDropdownOptions = useMemo(() => {
    return appOptions.map((app) => ({
      value: app.name,
      label: app.name,
      icon: (
        <AppIconBadge
          appName={app.name}
          iconPath={app.icon_path}
          size="option"
        />
      ),
    }));
  }, [appOptions]);

  const addApp = (name: string) => {
    if (!name) return;
    onUpdateList((current) => {
      const exists = current.apps.some(
        (app) => app.toLowerCase() === name.toLowerCase(),
      );
      if (exists) {
        return current;
      }
      return { ...current, apps: [...current.apps, name] };
    });
    setSelectedAppOption(null);
  };

  const removeApp = (name: string) => {
    onUpdateList((current) => ({
      ...current,
      apps: current.apps.filter(
        (app) => app.toLowerCase() !== name.toLowerCase(),
      ),
    }));
  };

  const addWebsite = () => {
    const value = normalizeWebsite(websiteInput);
    if (!value) {
      setWebsiteError(null);
      return;
    }
    if (!isValidDomain(value)) {
      setWebsiteError("Enter a valid domain like gmail.com");
      return;
    }
    const exists = personality.websites.some(
      (site) => site.toLowerCase() === value.toLowerCase(),
    );
    if (exists) {
      setWebsiteError("That domain is already added");
      return;
    }
    setWebsiteError(null);
    onUpdate({ websites: [...personality.websites, value] });
    setWebsiteInput("");
  };

  const removeWebsite = (site: string) => {
    onUpdate({
      websites: personality.websites.filter((entry) => entry !== site),
    });
  };

  const parseInstructions = (value: string) => {
    return value.split(/\r?\n/);
  };

  const handleInstructionsChange = (value: string) => {
    const nextValue = clampInstructionsText(value);
    setInstructionsText(nextValue);
    onUpdate({ instructions: parseInstructions(nextValue) });
  };

  const instructionsCharCount = useMemo(
    () => countInstructionsChars(instructionsText),
    [instructionsText],
  );

  const handleInstructionsResizeStart = (
    event: React.PointerEvent<HTMLButtonElement>,
  ) => {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    resizeStartYRef.current = event.clientY;
    resizeStartHeightRef.current = instructionsHeight;
    setIsResizingInstructions(true);
  };

  useEffect(() => {
    if (!isResizingInstructions) {
      return;
    }

    const handlePointerMove = (event: PointerEvent) => {
      const deltaY = event.clientY - resizeStartYRef.current;
      setInstructionsHeight(
        clampInstructionsHeight(resizeStartHeightRef.current + deltaY),
      );
    };

    const handlePointerUp = () => {
      setIsResizingInstructions(false);
    };

    const handlePointerCancel = () => {
      setIsResizingInstructions(false);
    };

    const handleWindowBlur = () => {
      setIsResizingInstructions(false);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerCancel);
    window.addEventListener("blur", handleWindowBlur);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerCancel);
      window.removeEventListener("blur", handleWindowBlur);
    };
  }, [isResizingInstructions]);

  const handleSaveName = () => {
    commitName();
    setIsEditingName(false);
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.15 }}
        className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 backdrop-blur-sm"
        onClick={onClose}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.96, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 20 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
          className="relative w-[520px] h-[620px] max-w-[92vw] max-h-[92vh] bg-surface-overlay border border-border-secondary rounded-2xl shadow-2xl flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between px-5 py-3 border-b border-border-primary">
            <div className="flex items-center gap-3">
              <DotMatrix
                rows={2}
                cols={3}
                activeDots={[0, 2, 3]}
                dotSize={3}
                gap={3}
                color="var(--color-cloud)"
                aria-hidden="true"
              />
              <div>
                <p className="ui-text-section-label ui-color-disabled tracking-[0.18em]">
                  Personalization
                </p>
                <div className="h-[28px] flex items-center">
                  {isEditingName ? (
                    <div className="flex items-center gap-2">
                      <input
                        ref={nameInputRef}
                        value={nameDraft}
                        onChange={(event) => setNameDraft(event.target.value)}
                        autoFocus
                        aria-label="Edit mode name"
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            handleSaveName();
                          }
                          if (event.key === "Escape") {
                            setNameDraft(personality.name);
                            setIsEditingName(false);
                          }
                        }}
                        onBlur={handleSaveName}
                        className="bg-transparent ui-text-title-lg font-semibold ui-color-primary outline-none border-b border-border-hover"
                      />
                      <button
                        onClick={handleSaveName}
                        className="h-[28px] w-[28px] flex items-center justify-center rounded hover:bg-border-secondary ui-color-primary"
                        aria-label="Save name"
                      >
                        <Check size={14} aria-hidden="true" />
                      </button>
                    </div>
                  ) : (
                    <div
                      onClick={() => {
                        if (personality.name === "New Mode") {
                          setNameDraft("");
                        }
                        setIsEditingName(true);
                      }}
                      className="group/title flex items-center gap-2 cursor-pointer"
                    >
                      <h2
                        id="modal-title"
                        className="ui-text-title-lg font-semibold ui-color-primary group-hover/title:text-content-secondary transition-colors"
                      >
                        {personality.name}
                      </h2>
                      <Pencil
                        size={12}
                        className="opacity-0 group-hover/title:opacity-100 transition-opacity text-content-muted"
                        aria-hidden="true"
                      />
                    </div>
                  )}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={onDelete}
                className="p-2 rounded-lg ui-color-error-strong hover:bg-red-500/10 transition-colors"
                title="Delete mode"
                aria-label="Delete mode"
              >
                <Trash2 size={14} aria-hidden="true" />
              </button>
              <button
                onClick={onClose}
                className="p-2 rounded-lg hover:bg-surface-elevated text-content-muted hover:text-content-primary transition-colors"
                aria-label="Close modal"
              >
                <X size={16} aria-hidden="true" />
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-4 p-4 flex-1 min-h-0">
            <section className="space-y-0.5">
              <p className="ui-text-section-label-sm ui-color-muted">
                Custom instructions
              </p>
              <div className="relative rounded-xl border border-border-primary bg-surface-surface p-2 px-3">
                <textarea
                  value={instructionsText}
                  onChange={(event) =>
                    handleInstructionsChange(event.target.value)
                  }
                  placeholder="Add custom instructions"
                  aria-label="Custom instructions"
                  className="w-full resize-none bg-transparent ui-text-label font-mono ui-color-primary placeholder-content-disabled outline-none instructions-scroll"
                  style={{ height: `${instructionsHeight}px` }}
                />
              </div>
              <div className="flex items-center justify-end gap-1">
                <span className="ui-text-meta ui-color-disabled tabular-nums">
                  {instructionsCharCount}/{MAX_INSTRUCTIONS_CHARS}
                </span>
                <button
                  type="button"
                  onPointerDown={handleInstructionsResizeStart}
                  className="h-4 w-4 rounded text-content-disabled hover:text-content-primary transition-colors cursor-pointer touch-none"
                  aria-label="Resize custom instructions"
                  title="Drag to resize"
                >
                  <svg
                    viewBox="0 0 20 20"
                    className="h-full w-full"
                    aria-hidden="true"
                  >
                    <path
                      d="M7 13L13 7M9.5 13L13 9.5M12 13L13 12"
                      stroke="currentColor"
                      strokeWidth="1.25"
                      strokeLinecap="round"
                    />
                  </svg>
                </button>
              </div>
            </section>

            <div className="grid grid-cols-2 gap-4 flex-1 min-h-0">
              <section className="space-y-2 flex flex-col min-h-0">
                <div className="flex items-center justify-between">
                  <p className="ui-text-section-label-sm ui-color-muted">
                    Applications
                  </p>
                  <span className="ui-text-meta ui-color-disabled">
                    {personality.apps.length} selected
                  </span>
                </div>
                <Dropdown
                  value={selectedAppOption}
                  onChange={(value) => {
                    setSelectedAppOption(value);
                    addApp(value);
                  }}
                  options={appDropdownOptions}
                  placeholder="Add application"
                  searchable
                  searchPlaceholder="Search applications..."
                  menuClassName="max-h-[220px]"
                />
                <div className="relative flex-1 min-h-0">
                  <div className="space-y-1 h-full instructions-scroll pr-2">
                    {personality.apps.length === 0 ? (
                      <div className="rounded-lg border border-border-primary bg-surface-surface px-3 py-3 ui-text-label ui-color-muted">
                        No applications selected
                      </div>
                    ) : (
                      personality.apps.map((app) => {
                        const installedApp = installedAppByName.get(
                          app.toLowerCase(),
                        );
                        const isMissing = !installedNameSet.has(
                          app.toLowerCase(),
                        );
                        return (
                          <div
                            key={app}
                            className="flex items-center justify-between rounded-lg border border-border-primary bg-surface-surface px-3 py-2"
                          >
                            <div className="flex items-center gap-2">
                              <AppIconBadge
                                appName={app}
                                iconPath={installedApp?.icon_path}
                                size="list"
                              />
                              <span className="ui-text-body-sm ui-color-primary">
                                {app}
                              </span>
                              {isMissing && (
                                <span className="ui-text-meta ui-color-disabled">
                                  Not installed
                                </span>
                              )}
                            </div>
                            <button
                              onClick={() => removeApp(app)}
                              className="rounded-md p-1.5 text-content-muted hover:text-content-primary hover:bg-surface-elevated transition-colors"
                              title="Remove"
                              aria-label={`Remove ${app}`}
                            >
                              <X size={12} />
                            </button>
                          </div>
                        );
                      })
                    )}
                  </div>
                  <div className="scroll-fade-bottom" aria-hidden="true" />
                </div>
              </section>

              <section className="space-y-2 flex flex-col min-h-0">
                <div className="flex items-center justify-between">
                  <p className="ui-text-section-label-sm ui-color-muted">
                    Websites
                  </p>
                  <span className="ui-text-meta ui-color-disabled">
                    {personality.websites.length} sites
                  </span>
                </div>
                <div className="flex items-center gap-2 rounded-lg border border-border-primary bg-surface-surface px-3 py-1.5 min-h-[40px] focus-within:border-border-hover transition-colors">
                  <input
                    value={websiteInput}
                    onChange={(event) => {
                      setWebsiteInput(event.target.value);
                      if (websiteError) {
                        setWebsiteError(null);
                      }
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        addWebsite();
                      }
                    }}
                    placeholder="Add a site like gmail.com"
                    aria-label="Add website domain"
                    className="bg-transparent ui-text-input ui-color-primary placeholder-content-disabled outline-none flex-1"
                  />
                  <button
                    onClick={addWebsite}
                    className="flex items-center gap-1 rounded-md bg-surface-elevated px-2 py-0.5 ui-text-button ui-color-primary hover:bg-surface-elevated-hover transition-colors"
                  >
                    <Plus size={12} aria-hidden="true" />
                    Add
                  </button>
                </div>
                {websiteError && (
                  <p className="ui-text-meta ui-color-error">{websiteError}</p>
                )}
                <div className="relative flex-1 min-h-0">
                  <div className="space-y-1 h-full instructions-scroll pr-2">
                    {personality.websites.length === 0 ? (
                      <div className="rounded-lg border border-border-primary bg-surface-surface px-3 py-3 ui-text-label ui-color-muted">
                        No websites added
                      </div>
                    ) : (
                      personality.websites.map((site) => (
                        <div
                          key={site}
                          className="flex items-center justify-between rounded-lg border border-border-primary bg-surface-surface px-3 py-2"
                        >
                          <div className="flex items-center gap-2">
                            <WebsiteFavicon
                              site={site}
                              iconPath={
                                websiteIconBySite[normalizeWebsite(site)]
                              }
                              size="list"
                            />
                            <span className="ui-text-label font-mono ui-color-primary">
                              {site}
                            </span>
                          </div>
                          <button
                            onClick={() => removeWebsite(site)}
                            className="rounded-md p-1.5 text-content-muted hover:text-content-primary hover:bg-surface-elevated transition-colors"
                            title="Remove"
                            aria-label={`Remove ${site}`}
                          >
                            <X size={12} />
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                  <div className="scroll-fade-bottom" aria-hidden="true" />
                </div>
              </section>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};

export default PersonalityModal;
