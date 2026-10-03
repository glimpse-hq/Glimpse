import { useLingui } from "@lingui/react/macro";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowsMerge,
  Eye,
  CaretRight as ChevronRight,
  PencilSimple as Pencil,
  Trash as Trash2,
  UserPlus,
  UserSwitch,
} from "@phosphor-icons/react";
import { useClickOutside } from "../../../shared/hooks/useClickOutside";
import { SPEAKER_COLORS } from "../speakerColors";
import type { Speaker } from "../../../types";

const MENU_EDGE = 8;

export const SpeakerMenuItem = ({
  icon,
  label,
  onClick,
  onMouseEnter,
  disabled = false,
  destructive = false,
  highlighted = false,
  trailing,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  onMouseEnter?: () => void;
  disabled?: boolean;
  destructive?: boolean;
  highlighted?: boolean;
  trailing?: ReactNode;
}) => (
  <button
    type="button"
    role="menuitem"
    onClick={onClick}
    onMouseEnter={onMouseEnter}
    disabled={disabled}
    className={`flex w-full items-center gap-2.5 px-3 py-2 text-left ui-text-menu-item transition-colors disabled:opacity-40 ${
      destructive
        ? "ui-color-error hover:bg-[var(--color-error)]/10"
        : `ui-color-secondary enabled:hover:bg-surface-elevated ${
            highlighted ? "bg-surface-elevated" : ""
          }`
    }`}
  >
    {icon}
    <span className="flex-1 truncate">{label}</span>
    {trailing}
  </button>
);

const SpeakerContextMenu = ({
  speaker,
  speakers,
  x,
  y,
  filtered = false,
  canAddSpeaker = false,
  onMoveLine,
  onMoveLineToNew,
  onRename,
  onRecolor,
  onMerge,
  onToggleFilter,
  onRemove,
  onClose,
}: {
  speaker: Speaker;
  speakers: Speaker[];
  x: number;
  y: number;
  filtered?: boolean;
  canAddSpeaker?: boolean;
  onMoveLine?: (speakerId: string) => void;
  onMoveLineToNew?: () => void;
  onRename: (name: string) => void;
  onRecolor: (color: string) => void;
  onMerge: (intoId: string) => void;
  onToggleFilter?: () => void;
  onRemove?: () => void;
  onClose: () => void;
}) => {
  const { t } = useLingui();
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const lineRowRef = useRef<HTMLDivElement>(null);
  const mergeRowRef = useRef<HTMLDivElement>(null);
  const submenuRef = useRef<HTMLDivElement>(null);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(speaker.name);
  const [submenu, setSubmenu] = useState<"line" | "merge" | null>(null);
  const [hoveredColor, setHoveredColor] = useState<string | null>(null);
  const [position, setPosition] = useState({ left: x, top: y });
  const [submenuPosition, setSubmenuPosition] = useState({ left: 0, top: 0 });
  const others = speakers.filter((entry) => entry.id !== speaker.id);
  const colorOwners = hoveredColor
    ? speakers
        .filter((entry) => entry.color === hoveredColor)
        .map((entry) => entry.name)
        .join(", ")
    : "";

  const commitRename = () => {
    const value = draft.trim();
    if (value && value !== speaker.name) onRename(value);
  };

  useClickOutside(rootRef, () => {
    if (renaming) commitRename();
    onClose();
  });

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const { width, height } = menu.getBoundingClientRect();
    const left = Math.min(x, window.innerWidth - width - MENU_EDGE);
    const top = y + height > window.innerHeight - MENU_EDGE ? y - height : y;
    setPosition({
      left: Math.max(MENU_EDGE, left),
      top: Math.max(MENU_EDGE, top),
    });
  }, [x, y]);

  useLayoutEffect(() => {
    const menu = menuRef.current;
    const row = submenu === "line" ? lineRowRef.current : mergeRowRef.current;
    const panel = submenuRef.current;
    if (!submenu || !menu || !row || !panel) return;
    const menuRect = menu.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    const { width, height } = panel.getBoundingClientRect();
    const left =
      menuRect.right + width + MENU_EDGE > window.innerWidth
        ? menuRect.left - width + 4
        : menuRect.right - 4;
    const top = Math.min(
      rowRect.top - 5,
      window.innerHeight - height - MENU_EDGE,
    );
    setSubmenuPosition({ left, top: Math.max(MENU_EDGE, top) });
  }, [submenu, position]);

  useEffect(() => {
    const close = (event: Event) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // Keeps the detail view from also closing.
      event.preventDefault();
      onClose();
    };
    document.addEventListener("scroll", close, true);
    window.addEventListener("resize", onClose);
    window.addEventListener("blur", onClose);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", onClose);
      window.removeEventListener("blur", onClose);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  const closeSubmenu = () => setSubmenu(null);
  const speakerDot = (entry: Speaker) => (
    <span
      className="inline-block h-2 w-2 shrink-0 rounded-full"
      style={{ backgroundColor: entry.color ?? undefined }}
      aria-hidden="true"
    />
  );

  return (
    <div ref={rootRef} onContextMenu={(event) => event.preventDefault()}>
      <motion.div
        ref={menuRef}
        role="menu"
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        transition={{ duration: 0.12 }}
        style={{ left: position.left, top: position.top }}
        className="ui-surface-menu fixed z-[130] w-56 origin-top-left py-1"
      >
        <div
          className="flex items-center gap-2.5 px-3 pt-1.5 pb-2"
          onMouseEnter={closeSubmenu}
        >
          {speakerDot(speaker)}
          {renaming ? (
            <input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onFocus={(event) => event.target.select()}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  commitRename();
                  onClose();
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  event.stopPropagation();
                  setDraft(speaker.name);
                  setRenaming(false);
                }
              }}
              aria-label={t({
                id: "library.detail.speaker_menu.rename",
                message: "Rename",
              })}
              className="min-w-0 flex-1 border-0 bg-transparent p-0 ui-text-menu-item font-medium ui-color-primary shadow-[inset_0_-1px_0_0_var(--color-border-hover)] outline-hidden"
              autoFocus
            />
          ) : (
            <span className="min-w-0 flex-1 truncate ui-text-menu-item font-medium ui-color-primary">
              {speaker.name}
            </span>
          )}
        </div>
        <div className="mb-1 h-px bg-[var(--border-subtle)]" />
        {onMoveLine && (
          <>
            <div ref={lineRowRef}>
              <SpeakerMenuItem
                icon={
                  <UserSwitch size={12} className="shrink-0 ui-color-muted" />
                }
                label={t({
                  id: "library.detail.speaker_menu.change_line",
                  message: "Change speaker for this line",
                })}
                highlighted={submenu === "line"}
                onMouseEnter={() => setSubmenu("line")}
                onClick={() =>
                  setSubmenu((open) => (open === "line" ? null : "line"))
                }
                trailing={
                  <ChevronRight size={11} className="shrink-0 ui-color-muted" />
                }
              />
            </div>
            <div className="my-1 h-px bg-[var(--border-subtle)]" />
          </>
        )}
        <SpeakerMenuItem
          icon={<Pencil size={12} className="shrink-0 ui-color-muted" />}
          label={t({
            id: "library.detail.speaker_menu.rename",
            message: "Rename",
          })}
          onMouseEnter={closeSubmenu}
          onClick={() => {
            setDraft(speaker.name);
            setRenaming(true);
          }}
        />
        <div ref={mergeRowRef}>
          <SpeakerMenuItem
            icon={<ArrowsMerge size={12} className="shrink-0 ui-color-muted" />}
            label={t({
              id: "library.detail.speaker_menu.merge",
              message: "Merge into",
            })}
            disabled={others.length === 0}
            highlighted={submenu === "merge"}
            onMouseEnter={() => setSubmenu(others.length > 0 ? "merge" : null)}
            onClick={() =>
              setSubmenu((open) =>
                open === "merge" || others.length === 0 ? null : "merge",
              )
            }
            trailing={
              <ChevronRight size={11} className="shrink-0 ui-color-muted" />
            }
          />
        </div>
        {onToggleFilter && (
          <SpeakerMenuItem
            icon={<Eye size={12} className="shrink-0 ui-color-muted" />}
            label={
              filtered
                ? t({
                    id: "library.detail.speaker_menu.show_all",
                    message: "Show all speakers",
                  })
                : t({
                    id: "library.detail.speaker_menu.show_only",
                    message: "Show only this speaker",
                  })
            }
            disabled={!filtered && others.length === 0}
            onMouseEnter={closeSubmenu}
            onClick={onToggleFilter}
          />
        )}
        <div className="my-1 h-px bg-[var(--border-subtle)]" />
        <div
          className="px-3 pt-1.5 pb-2"
          role="group"
          aria-label={t({
            id: "library.detail.speaker_menu.color",
            message: "Color",
          })}
          onMouseEnter={closeSubmenu}
          onMouseLeave={() => setHoveredColor(null)}
        >
          <div className="mb-2 flex h-4 items-center justify-between gap-2 ui-text-meta">
            <span className="ui-color-muted">
              {t({
                id: "library.detail.speaker_menu.color",
                message: "Color",
              })}
            </span>
            <span className="min-w-0 truncate ui-color-secondary">
              {colorOwners}
            </span>
          </div>
          <div className="flex items-center justify-between">
            {SPEAKER_COLORS.map((color) => {
              const selected = speaker.color === color;
              return (
                <button
                  key={color}
                  type="button"
                  onClick={() => onRecolor(color)}
                  onMouseEnter={() => setHoveredColor(color)}
                  onFocus={() => setHoveredColor(color)}
                  aria-pressed={selected}
                  aria-label={color}
                  className={`h-3.5 w-3.5 rounded-full transition-transform hover:scale-110 ${
                    selected
                      ? "ring-2 ring-[var(--color-border-hover)] ring-offset-2 ring-offset-[var(--surface-floating)]"
                      : ""
                  }`}
                  style={{ backgroundColor: color }}
                />
              );
            })}
          </div>
        </div>
        {onRemove && (
          <>
            <div className="my-1 h-px bg-[var(--border-subtle)]" />
            <SpeakerMenuItem
              icon={<Trash2 size={12} className="shrink-0" />}
              label={t({
                id: "library.detail.speaker_menu.remove",
                message: "Remove speaker",
              })}
              destructive
              onMouseEnter={closeSubmenu}
              onClick={onRemove}
            />
          </>
        )}
      </motion.div>
      <AnimatePresence>
        {submenu && (
          <motion.div
            key={submenu}
            ref={submenuRef}
            role="menu"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.1 }}
            style={{ left: submenuPosition.left, top: submenuPosition.top }}
            className="ui-surface-menu fixed z-[131] w-48 max-h-72 overflow-y-auto custom-scrollbar py-1"
          >
            {others.map((entry) => (
              <SpeakerMenuItem
                key={entry.id}
                icon={speakerDot(entry)}
                label={entry.name}
                onClick={() =>
                  submenu === "line"
                    ? onMoveLine?.(entry.id)
                    : onMerge(entry.id)
                }
              />
            ))}
            {submenu === "line" && onMoveLineToNew && (
              <>
                {others.length > 0 && (
                  <div className="my-1 h-px bg-[var(--border-subtle)]" />
                )}
                <SpeakerMenuItem
                  icon={
                    <UserPlus size={12} className="shrink-0 ui-color-muted" />
                  }
                  label={t({
                    id: "library.detail.assign_new_speaker",
                    message: "Assign new speaker",
                  })}
                  disabled={!canAddSpeaker}
                  onClick={onMoveLineToNew}
                />
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default SpeakerContextMenu;
