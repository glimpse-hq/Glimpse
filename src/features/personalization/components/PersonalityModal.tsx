import { useLingui } from "@lingui/react/macro";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { convertFileSrc } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  ArrowCounterClockwise,
  CaretDown as ChevronDown,
  ArrowSquareOut as ExternalLink,
  Info,
  PencilSimple as Pencil,
  Plus,
  Trash as Trash2,
  X,
} from "@phosphor-icons/react";
import { useClickOutside } from "../../../shared/hooks/useClickOutside";
import { useFocusTrap } from "../../../shared/hooks/useFocusTrap";
import { detectAppPlatform } from "../../../platform/service";
import type { Personality } from "../../../types";
import {
  clampInstructionsText,
  countInstructionsChars,
  getInitials,
  getWebsiteFallback,
  isValidDomain,
  MAX_INSTRUCTIONS_CHARS,
  GLOBAL_MODE_ID,
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
  size?: "chip" | "list";
};

const useWindowsAppIconSizing = detectAppPlatform() === "windows";

const AppIconBadge = ({
  appName,
  iconPath,
  size = "chip",
}: AppIconBadgeProps) => {
  const iconUrl = iconPath ? convertFileSrc(iconPath) : null;
  const sizeClass = size === "chip" ? "h-6 w-6" : "h-[18px] w-[18px]";
  const textClass =
    size === "chip" ? "ui-text-micro" : "text-[9px] leading-none";
  const baseClass = `${sizeClass} shrink-0 flex items-center justify-center`;

  if (iconUrl) {
    return (
      <span className={`${baseClass} overflow-visible`} aria-hidden="true">
        <img
          src={iconUrl}
          alt=""
          className={
            useWindowsAppIconSizing
              ? "h-full w-full object-contain"
              : "h-full w-full object-contain scale-[1.18]"
          }
          loading="lazy"
        />
      </span>
    );
  }

  return (
    <span
      className={`${baseClass} rounded-md bg-surface-elevated ui-color-muted`}
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
        className={`${sizeClass} shrink-0 rounded-xs border border-border-secondary bg-surface-overlay flex items-center justify-center ui-color-secondary ${fallbackTextClass}`}
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
      className={`${sizeClass} shrink-0 rounded-xs`}
      loading="lazy"
      aria-hidden="true"
    />
  );
};

export { AppIconBadge, WebsiteFavicon };

type PersonalityModalProps = {
  personality: Personality;
  defaultInstructions: string;
  installedApps: InstalledApp[];
  websiteIconBySite: Record<string, string>;
  onClose: () => void;
  onUpdate: (patch: Partial<Personality>) => void;
  onUpdateList: (updater: (current: Personality) => Personality) => void;
  onDelete: () => void;
};

const PERSONALIZATION_SNIPPETS_WIKI_URL =
  "https://github.com/glimpse-hq/Glimpse/wiki/snippets";

const iconButtonClass =
  "flex h-7 w-7 items-center justify-center rounded-md text-content-muted transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-hover";

const PersonalityModal = ({
  personality,
  defaultInstructions,
  installedApps,
  websiteIconBySite,
  onClose,
  onUpdate,
  onUpdateList,
  onDelete,
}: PersonalityModalProps) => {
  const { t } = useLingui();
  const isGlobal = personality.id === GLOBAL_MODE_ID;
  const [isEditingName, setIsEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(personality.name);
  const [appQuery, setAppQuery] = useState("");
  const [isAppMenuOpen, setIsAppMenuOpen] = useState(false);
  const [appHighlightIndex, setAppHighlightIndex] = useState(0);
  const appComboboxRef = useRef<HTMLDivElement>(null);
  const appInputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const appListId = useId();
  useFocusTrap(dialogRef, true);
  const [websiteInput, setWebsiteInput] = useState("");
  const [websiteError, setWebsiteError] = useState<string | null>(null);
  // Global stores nothing until edited, so it opens on the shipped prompt.
  const [instructionsText, setInstructionsText] = useState(() =>
    clampInstructionsText(
      personality.instructions.join("\n") ||
        (isGlobal ? defaultInstructions : ""),
    ),
  );
  const isDefaultGlobal =
    isGlobal && instructionsText.trim() === defaultInstructions.trim();

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

  const addedAppsSet = useMemo(() => {
    return new Set(personality.apps.map((app) => app.toLowerCase()));
  }, [personality.apps]);

  const filteredAppOptions = useMemo(() => {
    const query = appQuery.trim().toLowerCase();
    return appOptions.filter((app) => {
      if (addedAppsSet.has(app.name.toLowerCase())) {
        return false;
      }
      if (!query) {
        return true;
      }
      return app.name.toLowerCase().includes(query);
    });
  }, [appOptions, addedAppsSet, appQuery]);

  useEffect(() => {
    setAppHighlightIndex(appQuery.trim() ? 0 : -1);
  }, [appQuery, isAppMenuOpen]);

  useClickOutside(appComboboxRef, () => setIsAppMenuOpen(false), isAppMenuOpen);

  const addApp = (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onUpdateList((current) => {
      const exists = current.apps.some(
        (app) => app.toLowerCase() === trimmed.toLowerCase(),
      );
      if (exists) {
        return current;
      }
      return { ...current, apps: [...current.apps, trimmed] };
    });
    setAppQuery("");
    setIsAppMenuOpen(false);
  };

  const handleAppInputKeyDown = (
    event: React.KeyboardEvent<HTMLInputElement>,
  ) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setIsAppMenuOpen(true);
      setAppHighlightIndex((index) =>
        filteredAppOptions.length === 0
          ? 0
          : Math.min(index + 1, filteredAppOptions.length - 1),
      );
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setAppHighlightIndex((index) => Math.max(index - 1, 0));
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const highlight = filteredAppOptions[appHighlightIndex];
      if (highlight) {
        addApp(highlight.name);
      } else if (appQuery.trim()) {
        addApp(appQuery);
      }
      return;
    }
    if (event.key === "Escape" && isAppMenuOpen) {
      event.preventDefault();
      setIsAppMenuOpen(false);
    }
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
      setWebsiteError(
        t({
          id: "personalization.modal.website.invalid",
          message: "Enter a valid domain like gmail.com",
        }),
      );
      return;
    }
    const exists = personality.websites.some(
      (site) => site.toLowerCase() === value.toLowerCase(),
    );
    if (exists) {
      setWebsiteError(
        t({
          id: "personalization.modal.website.duplicate",
          message: "That domain is already added",
        }),
      );
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

  const handleInstructionsChange = (value: string) => {
    const nextValue = clampInstructionsText(value);
    setInstructionsText(nextValue);
    const unchangedGlobal =
      isGlobal && nextValue.trim() === defaultInstructions.trim();
    onUpdate({
      instructions: unchangedGlobal ? [] : nextValue.split(/\r?\n/),
    });
  };

  const handleSaveName = () => {
    commitName();
    setIsEditingName(false);
  };

  const sectionLabelClass = "ui-text-section-label-sm ui-color-muted";
  const fieldClass =
    "flex items-center gap-1 border-b border-border-primary transition-colors focus-within:border-border-hover";
  const fieldInputClass =
    "min-w-0 flex-1 bg-transparent py-2 ui-text-body-sm ui-color-primary placeholder-content-disabled focus:outline-none";
  const rowClass = "group/row flex items-center justify-between gap-2 py-2";
  const removeButtonClass =
    "rounded-md p-1 text-content-disabled opacity-0 transition-[opacity,color,background-color] hover:bg-surface-elevated hover:text-content-primary focus-visible:opacity-100 group-hover/row:opacity-100";

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.15 }}
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 p-16 backdrop-blur-xs"
      onClick={onClose}
    >
      <motion.div
        ref={dialogRef}
        initial={{ opacity: 0, scale: 0.97 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.18, ease: "easeOut" }}
        className="flex h-full max-h-[820px] w-full max-w-[960px] flex-col overflow-hidden rounded-2xl border border-border-primary bg-surface-tertiary ui-shadow-modal-deep"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="personality-modal-title"
      >
        <header className="flex shrink-0 items-center justify-between gap-4 px-8 pt-5">
          <div className="flex h-8 min-w-0 flex-1 items-center">
            {isGlobal ? (
              <h2
                id="personality-modal-title"
                className="ui-text-title-lg ui-color-primary"
              >
                {t({ id: "personalization.global.name", message: "Global" })}
              </h2>
            ) : isEditingName ? (
              <input
                value={nameDraft}
                onChange={(event) => setNameDraft(event.target.value)}
                autoFocus
                aria-label={t({
                  id: "personalization.modal.edit_name",
                  message: "Edit mode name",
                })}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    handleSaveName();
                  }
                  if (event.key === "Escape") {
                    event.preventDefault();
                    event.stopPropagation();
                    setNameDraft(personality.name);
                    setIsEditingName(false);
                  }
                }}
                onBlur={handleSaveName}
                className="w-full min-w-0 border-b border-border-hover bg-transparent ui-text-title-lg ui-color-primary outline-hidden"
              />
            ) : (
              <h2 id="personality-modal-title" className="min-w-0">
                <button
                  type="button"
                  onClick={() => {
                    if (
                      personality.name ===
                      t({
                        id: "personalization.new_mode.default_name.v2",
                        message: "New mode",
                      })
                    ) {
                      setNameDraft("");
                    }
                    setIsEditingName(true);
                  }}
                  title={t({
                    id: "personalization.modal.edit_name",
                    message: "Edit mode name",
                  })}
                  className="group/title flex min-w-0 max-w-full items-center gap-2 text-left"
                >
                  <span className="truncate ui-text-title-lg ui-color-primary transition-colors group-hover/title:text-content-secondary">
                    {personality.name}
                  </span>
                  <Pencil
                    size={13}
                    className="shrink-0 text-content-muted opacity-0 transition-opacity group-hover/title:opacity-100 group-focus-visible/title:opacity-100"
                    aria-hidden="true"
                  />
                </button>
              </h2>
            )}
          </div>
          <div className="flex h-8 shrink-0 items-center gap-1">
            {!isGlobal && (
              <button
                type="button"
                onClick={onDelete}
                className={`${iconButtonClass} hover:bg-red-500/10 hover:text-red-400`}
                title={t({
                  id: "personalization.modal.delete_mode",
                  message: "Delete mode",
                })}
                aria-label={t({
                  id: "personalization.modal.delete_mode",
                  message: "Delete mode",
                })}
              >
                <Trash2 size={14} aria-hidden="true" />
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className={`${iconButtonClass} hover:bg-surface-elevated hover:text-content-secondary`}
              aria-label={t({
                id: "personalization.modal.close",
                message: "Close modal",
              })}
            >
              <X size={15} aria-hidden="true" />
            </button>
          </div>
        </header>

        <div className="flex min-h-0 flex-1 flex-col gap-6 px-8 pb-6 pt-3">
          <section className="flex min-h-0 flex-1 flex-col">
            <div className="flex h-6 items-center justify-between gap-3">
              <div className="flex items-center gap-1.5">
                <h3 className={sectionLabelClass}>
                  {t({
                    id: "personalization.modal.instructions",
                    message: "Instructions",
                  })}
                </h3>
                <div className="group/snippets relative">
                  <button
                    type="button"
                    className="flex h-4 w-4 items-center justify-center rounded-sm text-content-disabled transition-colors hover:text-content-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-hover"
                    aria-label={t({
                      id: "personalization.modal.snippets.info",
                      message: "Show personalization snippet examples",
                    })}
                  >
                    <Info size={11} aria-hidden="true" />
                  </button>
                  <div
                    role="tooltip"
                    className="absolute left-full top-1/2 z-30 hidden -translate-y-[42%] pl-2 group-hover/snippets:block group-focus-within/snippets:block"
                  >
                    <div className="w-72 rounded-lg border border-border-secondary bg-surface-overlay px-3 py-2.5 text-left shadow-lg">
                      <p className="ui-text-meta ui-color-primary">
                        {t({
                          id: "personalization.modal.snippets.summary",
                          message:
                            "Use snippets to pass live context to the language model, like",
                        })}{" "}
                        <code>{"{{date}}"}</code>, <code>{"{{app}}"}</code>,{" "}
                        <code>{"{{window}}"}</code>.
                      </p>
                      <button
                        type="button"
                        onClick={() => {
                          void openUrl(PERSONALIZATION_SNIPPETS_WIKI_URL);
                        }}
                        className="mt-2 inline-flex items-center gap-1 ui-text-meta ui-color-muted underline decoration-border-hover underline-offset-2 transition-colors hover:text-content-secondary"
                      >
                        {t({
                          id: "personalization.modal.snippets.full_list",
                          message: "Full snippet list",
                        })}
                        <ExternalLink size={10} aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-4">
                {isGlobal && (
                  <button
                    type="button"
                    disabled={isDefaultGlobal}
                    onClick={() =>
                      handleInstructionsChange(defaultInstructions)
                    }
                    className="inline-flex items-center gap-1.5 rounded-md ui-text-meta ui-color-secondary transition-colors hover:text-content-primary disabled:invisible focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-hover"
                  >
                    <ArrowCounterClockwise size={12} aria-hidden="true" />
                    {t({
                      id: "personalization.modal.restore_default",
                      message: "Restore default",
                    })}
                  </button>
                )}
                <span className="ui-text-meta ui-color-disabled tabular-nums">
                  {countInstructionsChars(instructionsText)}/
                  {MAX_INSTRUCTIONS_CHARS}
                </span>
              </div>
            </div>
            {/* py-3 keeps the scrollbar clear of the rounded corners */}
            <div className="mt-3 min-h-0 flex-1 rounded-xl border border-transparent bg-[var(--surface-interactive)] py-3 pr-1 transition-colors focus-within:border-border-hover">
              <textarea
                value={instructionsText}
                onChange={(event) =>
                  handleInstructionsChange(event.target.value)
                }
                placeholder={t({
                  id: "personalization.modal.custom_instructions.placeholder",
                  message: "Add custom instructions",
                })}
                aria-label={t({
                  id: "personalization.modal.instructions",
                  message: "Instructions",
                })}
                className="h-full w-full resize-none bg-transparent px-5 py-1 ui-text-body-sm leading-relaxed ui-color-primary placeholder-content-disabled outline-hidden instructions-scroll"
              />
            </div>
          </section>

          {!isGlobal && (
            <div className="grid h-[224px] shrink-0 grid-cols-2 gap-10">
              <section className="flex min-h-0 min-w-0 flex-col">
                <div className="flex h-6 items-center justify-between gap-2">
                  <h3 className={sectionLabelClass}>
                    {t({
                      id: "personalization.modal.applications",
                      message: "Applications",
                    })}
                  </h3>
                  <span className="ui-text-meta ui-color-disabled tabular-nums">
                    {personality.apps.length}
                  </span>
                </div>
                <div
                  ref={appComboboxRef}
                  className={`relative mt-1 ${fieldClass}`}
                >
                  <input
                    ref={appInputRef}
                    value={appQuery}
                    onChange={(event) => {
                      setAppQuery(event.target.value);
                      setIsAppMenuOpen(true);
                    }}
                    onFocus={() => setIsAppMenuOpen(true)}
                    onKeyDown={handleAppInputKeyDown}
                    placeholder={t({
                      id: "personalization.modal.applications.add",
                      message: "Add application",
                    })}
                    aria-label={t({
                      id: "personalization.modal.applications.add",
                      message: "Add application",
                    })}
                    role="combobox"
                    aria-expanded={
                      isAppMenuOpen && filteredAppOptions.length > 0
                    }
                    aria-controls={appListId}
                    aria-activedescendant={
                      isAppMenuOpen && filteredAppOptions[appHighlightIndex]
                        ? `${appListId}-${appHighlightIndex}`
                        : undefined
                    }
                    aria-autocomplete="list"
                    className={fieldInputClass}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setIsAppMenuOpen((open) => !open);
                      appInputRef.current?.focus();
                    }}
                    aria-label={t({
                      id: "personalization.modal.applications.toggle_list",
                      message: "Toggle application list",
                    })}
                    aria-expanded={isAppMenuOpen}
                    className="inline-flex shrink-0 items-center justify-center rounded-md p-1 text-content-muted transition-colors hover:bg-surface-elevated hover:text-content-primary"
                  >
                    <ChevronDown
                      size={14}
                      aria-hidden="true"
                      className={`transition-transform ${isAppMenuOpen ? "rotate-180" : ""}`}
                    />
                  </button>
                  <AnimatePresence>
                    {isAppMenuOpen && filteredAppOptions.length > 0 && (
                      <motion.ul
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.12 }}
                        id={appListId}
                        role="listbox"
                        aria-label={t({
                          id: "personalization.modal.applications",
                          message: "Applications",
                        })}
                        className="ui-surface-menu dropdown-list absolute bottom-full left-0 right-0 z-30 mb-2 max-h-[240px] px-1 py-1"
                      >
                        {filteredAppOptions.map((app, index) => (
                          <li key={`app-option-${app.name}`}>
                            <button
                              id={`${appListId}-${index}`}
                              type="button"
                              role="option"
                              tabIndex={-1}
                              aria-selected={index === appHighlightIndex}
                              onMouseEnter={() => setAppHighlightIndex(index)}
                              onMouseDown={(event) => event.preventDefault()}
                              onClick={() => addApp(app.name)}
                              className={`flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left ui-text-body-sm transition-colors duration-100 ${
                                index === appHighlightIndex
                                  ? "bg-[var(--surface-interactive)] text-content-primary"
                                  : "text-content-secondary"
                              }`}
                            >
                              <AppIconBadge
                                appName={app.name}
                                iconPath={app.icon_path}
                                size="list"
                              />
                              <span className="truncate">{app.name}</span>
                            </button>
                          </li>
                        ))}
                      </motion.ul>
                    )}
                  </AnimatePresence>
                </div>
                <div className="mt-1 min-h-0 flex-1 overflow-y-auto instructions-scroll">
                  {personality.apps.length === 0 ? (
                    <p className="py-2.5 ui-text-body-sm ui-color-disabled">
                      {t({
                        id: "personalization.modal.applications.none",
                        message: "No applications selected",
                      })}
                    </p>
                  ) : (
                    <ul className="divide-y divide-border-primary">
                      {personality.apps.map((app) => {
                        const installedApp = installedAppByName.get(
                          app.toLowerCase(),
                        );
                        return (
                          <li key={`app-${app}`} className={rowClass}>
                            <div className="flex min-w-0 items-center gap-2.5">
                              <AppIconBadge
                                appName={app}
                                iconPath={installedApp?.icon_path}
                                size="list"
                              />
                              <span className="truncate ui-text-body-sm ui-color-primary">
                                {app}
                              </span>
                              {!installedApp && (
                                <span className="shrink-0 ui-text-meta ui-color-disabled">
                                  {t({
                                    id: "personalization.modal.applications.not_installed",
                                    message: "Not installed",
                                  })}
                                </span>
                              )}
                            </div>
                            <button
                              type="button"
                              onClick={() => removeApp(app)}
                              className={removeButtonClass}
                              title={t({
                                id: "personalization.modal.remove",
                                message: "Remove",
                              })}
                              aria-label={t({
                                id: "personalization.modal.remove_app",
                                message: `Remove ${app}`,
                              })}
                            >
                              <X size={12} aria-hidden="true" />
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </section>

              <section className="flex min-h-0 min-w-0 flex-col">
                <div className="flex h-6 items-center justify-between gap-2">
                  <h3 className={`shrink-0 ${sectionLabelClass}`}>
                    {t({
                      id: "personalization.modal.websites",
                      message: "Websites",
                    })}
                  </h3>
                  {websiteError ? (
                    <span
                      role="alert"
                      className="min-w-0 truncate ui-text-meta ui-color-error"
                      title={websiteError}
                    >
                      {websiteError}
                    </span>
                  ) : (
                    <span className="ui-text-meta ui-color-disabled tabular-nums">
                      {personality.websites.length}
                    </span>
                  )}
                </div>
                <div className={`mt-1 ${fieldClass}`}>
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
                    placeholder={t({
                      id: "personalization.modal.websites.placeholder",
                      message: "Add a site like gmail.com",
                    })}
                    aria-label={t({
                      id: "personalization.modal.websites.aria",
                      message: "Add website domain",
                    })}
                    className={fieldInputClass}
                  />
                  <button
                    type="button"
                    onClick={addWebsite}
                    aria-label={t({
                      id: "personalization.modal.add",
                      message: "Add",
                    })}
                    className="inline-flex shrink-0 items-center justify-center rounded-md p-1 text-content-muted transition-colors hover:bg-surface-elevated hover:text-content-primary"
                  >
                    <Plus size={14} aria-hidden="true" />
                  </button>
                </div>
                <div className="mt-1 min-h-0 flex-1 overflow-y-auto instructions-scroll">
                  {personality.websites.length === 0 ? (
                    <p className="py-2.5 ui-text-body-sm ui-color-disabled">
                      {t({
                        id: "personalization.modal.websites.none",
                        message: "No websites added",
                      })}
                    </p>
                  ) : (
                    <ul className="divide-y divide-border-primary">
                      {personality.websites.map((site) => (
                        <li key={`site-${site}`} className={rowClass}>
                          <div className="flex min-w-0 items-center gap-2.5">
                            <WebsiteFavicon
                              site={site}
                              iconPath={
                                websiteIconBySite[normalizeWebsite(site)]
                              }
                              size="list"
                            />
                            <span className="truncate ui-text-body-sm ui-color-primary">
                              {site}
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={() => removeWebsite(site)}
                            className={removeButtonClass}
                            title={t({
                              id: "personalization.modal.remove",
                              message: "Remove",
                            })}
                            aria-label={t({
                              id: "personalization.modal.remove_site",
                              message: `Remove ${site}`,
                            })}
                          >
                            <X size={12} aria-hidden="true" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </section>
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
};

export default PersonalityModal;
