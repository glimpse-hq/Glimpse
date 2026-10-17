import { useRef, useState } from "react";
import { useLingui } from "@lingui/react/macro";
import { AnimatePresence, motion } from "framer-motion";
import { Check, DotsThree, Ghost, Trash } from "@phosphor-icons/react";
import HoverTip from "../../../shared/ui/HoverTip";
import ToggleSwitch from "../../../shared/ui/ToggleSwitch";
import { Dropdown } from "../../../shared/ui/Dropdown";
import { useClickOutside } from "../../../shared/hooks/useClickOutside";
import { useMenuKeyboard } from "../../../shared/hooks/useMenuKeyboard";
import { formatShortcutForDisplay } from "../../../shared/lib/shortcuts";
import type { ShortcutBinding, ShortcutBindings } from "../../../types";

type ShortcutMode = "smart" | "hold" | "toggle";
type CaptureMode = { mode: ShortcutMode; index: number } | null;

const MODES: ShortcutMode[] = ["smart", "hold", "toggle"];
const MAX_PER_MODE = 3;

type ShortcutListProps = {
  bindings: ShortcutBindings;
  invalidDrafts: Partial<Record<ShortcutMode, Record<number, string>>>;
  captureActive: CaptureMode;
  capturePreview: string;
  cleanupDisabled: boolean;
  onStartCapture: (mode: ShortcutMode, index?: number) => void;
  onUpdate: (
    mode: ShortcutMode,
    index: number,
    patch: Partial<ShortcutBinding>,
  ) => void;
  onAdd: (mode: ShortcutMode) => void;
  onRemove: (mode: ShortcutMode, index: number) => void;
  onMove: (from: ShortcutMode, index: number, to: ShortcutMode) => void;
};

const ShortcutList = ({
  bindings,
  invalidDrafts,
  captureActive,
  capturePreview,
  cleanupDisabled,
  onStartCapture,
  onUpdate,
  onAdd,
  onRemove,
  onMove,
}: ShortcutListProps) => {
  const { t } = useLingui();
  const rows = MODES.flatMap((mode) =>
    bindings[mode].map((binding, index) => ({ mode, index, binding })),
  );
  const modeWithRoom = MODES.find(
    (mode) => bindings[mode].length < MAX_PER_MODE,
  );
  const behaviorOptions = (current: ShortcutMode) => [
    {
      value: "smart" as const,
      label: t({ id: "settings.general.shortcuts.smart", message: "Smart" }),
      description: t({
        id: "settings.general.shortcuts.smart_description",
        message: "tap to toggle, hold to talk",
      }),
      locked: current !== "smart" && bindings.smart.length >= MAX_PER_MODE,
    },
    {
      value: "hold" as const,
      label: t({ id: "settings.general.shortcuts.hold", message: "Hold" }),
      description: t({
        id: "settings.general.shortcuts.hold_description",
        message: "hold to talk, release to stop",
      }),
      locked: current !== "hold" && bindings.hold.length >= MAX_PER_MODE,
    },
    {
      value: "toggle" as const,
      label: t({ id: "settings.general.shortcuts.toggle", message: "Toggle" }),
      description: t({
        id: "settings.general.shortcuts.toggle_description",
        message: "tap to start, tap to stop",
      }),
      locked: current !== "toggle" && bindings.toggle.length >= MAX_PER_MODE,
    },
  ];
  const addShortcutLabel = t({
    id: "settings.general.shortcuts.add_shortcut",
    message: "+ Add shortcut",
  });
  const cleanupLabel = t({
    id: "settings.general.shortcuts.column.cleanup",
    message: "Clean up",
  });

  return (
    <div className="rounded-lg bg-surface-surface p-2.5">
      <div className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto] items-center gap-x-3 px-2 py-1.5">
        <div className="col-span-4 grid grid-cols-subgrid pb-1 ui-text-meta ui-color-muted">
          <span>
            {t({
              id: "settings.general.shortcuts.column.shortcut",
              message: "Shortcut",
            })}
          </span>
          <span className="px-1">
            {t({
              id: "settings.general.shortcuts.column.behavior",
              message: "Behavior",
            })}
          </span>
          <HoverTip
            label={cleanupLabel}
            detail={t({
              id: "settings.general.shortcuts.column.cleanup_tip",
              message:
                "Sends dictation from this shortcut through your cleanup model and writing modes. With text selected, speak an instruction to rewrite it.",
            })}
            className="inline-flex justify-self-center"
          >
            <span>{cleanupLabel}</span>
          </HoverTip>
          <span aria-hidden="true" className="w-5" />
        </div>

        {rows.map(({ mode, index, binding }) => {
          const capturing =
            captureActive?.mode === mode && captureActive.index === index;
          const display = binding.shortcut
            ? formatShortcutForDisplay(binding.shortcut)
            : addShortcutLabel;
          return (
            <div
              key={`${mode}-${index}`}
              role="group"
              aria-label={display}
              className={`group col-span-4 grid min-h-8 grid-cols-subgrid items-center border-b py-1 transition-colors ${
                capturing
                  ? "border-border-hover"
                  : invalidDrafts[mode]?.[index]
                    ? "border-error/40"
                    : "border-border-primary hover:border-border-secondary"
              }`}
            >
              <button
                type="button"
                onClick={() => onStartCapture(mode, index)}
                className={`flex min-w-0 items-center gap-1.5 text-left ui-text-kbd transition-colors hover:text-content-primary ${
                  invalidDrafts[mode]?.[index]
                    ? "ui-color-error"
                    : capturing
                      ? "ui-color-primary"
                      : "ui-color-secondary"
                }`}
              >
                {capturing ? (
                  <>
                    <motion.span
                      aria-hidden="true"
                      className="h-1 w-1 shrink-0 rounded-full bg-cloud"
                      animate={{ opacity: [0.3, 1, 0.3] }}
                      transition={{ duration: 1, repeat: Infinity }}
                    />
                    <span
                      aria-live="polite"
                      className={`truncate ${capturePreview ? "ui-color-primary" : "ui-color-muted"}`}
                    >
                      {capturePreview || "..."}
                    </span>
                  </>
                ) : (
                  <span className="truncate">{display}</span>
                )}
              </button>
              <Dropdown<ShortcutMode>
                value={mode}
                ariaLabel={t({
                  id: "settings.general.shortcuts.column.behavior",
                  message: "Behavior",
                })}
                onChange={(next) => onMove(mode, index, next)}
                options={behaviorOptions(mode)}
                fitButtonToWidestOption
                buttonClassName="!border-0 !bg-transparent !px-1 !py-0.5 ui-text-body-sm ui-color-secondary hover:!text-content-primary"
                menuClassName="!left-auto min-w-[220px]"
              />
              <div className="flex justify-center">
                <ToggleSwitch
                  enabled={binding.cleanup_enabled}
                  disabled={cleanupDisabled}
                  onToggle={() =>
                    onUpdate(mode, index, {
                      cleanup_enabled: !binding.cleanup_enabled,
                    })
                  }
                  ariaLabel={cleanupLabel}
                />
              </div>
              <ShortcutRowMenu
                saved={!binding.temporary}
                canRemove={rows.length > 1}
                onToggleSaved={() =>
                  onUpdate(mode, index, { temporary: !binding.temporary })
                }
                onRemove={() => onRemove(mode, index)}
              />
            </div>
          );
        })}

        <button
          type="button"
          onClick={() => modeWithRoom && onAdd(modeWithRoom)}
          disabled={!modeWithRoom}
          className="col-span-4 h-7 border-b border-dashed border-border-primary text-left ui-text-meta ui-color-disabled transition-colors hover:border-border-secondary hover:ui-color-muted disabled:pointer-events-none"
        >
          {addShortcutLabel}
        </button>
      </div>
    </div>
  );
};

const ShortcutRowMenu = ({
  saved,
  canRemove,
  onToggleSaved,
  onRemove,
}: {
  saved: boolean;
  canRemove: boolean;
  onToggleSaved: () => void;
  onRemove: () => void;
}) => {
  const { t } = useLingui();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  useClickOutside(ref, () => setOpen(false), open);
  useMenuKeyboard(menuRef, open, () => setOpen(false));
  const notSavedLabel = t({
    id: "settings.general.shortcuts.not_saved",
    message: "Not saved to Library",
  });
  const moreLabel = t({
    id: "settings.general.shortcuts.more",
    message: "Shortcut options",
  });

  const trigger = (
    <button
      type="button"
      onClick={() => setOpen((value) => !value)}
      aria-haspopup="menu"
      aria-expanded={open}
      aria-label={saved ? moreLabel : `${moreLabel}, ${notSavedLabel}`}
      className={`ui-button-ghost h-5 w-5 transition-opacity ${
        saved && !open
          ? "opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
          : "opacity-100"
      }`}
    >
      {saved ? (
        <DotsThree size={14} aria-hidden="true" />
      ) : (
        <Ghost size={13} aria-hidden="true" />
      )}
    </button>
  );

  return (
    <div className="relative flex w-5 justify-center" ref={ref}>
      {saved ? (
        trigger
      ) : (
        <HoverTip
          label={notSavedLabel}
          detail={t({
            id: "settings.general.shortcuts.not_saved_detail",
            message:
              "Text from this shortcut is pasted, but its audio and transcript aren't kept.",
          })}
          className="inline-flex"
        >
          {trigger}
        </HoverTip>
      )}

      <AnimatePresence>
        {open && (
          <motion.div
            ref={menuRef}
            role="menu"
            aria-label={moreLabel}
            initial={{ opacity: 0, scale: 0.95, y: -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -4 }}
            transition={{ duration: 0.12 }}
            className="ui-surface-menu absolute right-0 top-full mt-1 z-[100] min-w-[184px] origin-top-right py-1"
          >
            <button
              type="button"
              role="menuitemcheckbox"
              aria-checked={saved}
              onClick={() => {
                onToggleSaved();
                setOpen(false);
              }}
              className="flex w-full items-center gap-2.5 px-3 py-2 ui-text-menu-item ui-color-secondary hover:bg-surface-elevated focus-visible:bg-surface-elevated focus-visible:outline-none transition-colors"
            >
              <span className="flex w-3" aria-hidden="true">
                {saved && <Check size={12} className="text-content-muted" />}
              </span>
              <span>
                {t({
                  id: "settings.general.shortcuts.save_to_library",
                  message: "Save to Library",
                })}
              </span>
            </button>
            <button
              type="button"
              role="menuitem"
              disabled={!canRemove}
              onClick={() => {
                onRemove();
                setOpen(false);
              }}
              className="flex w-full items-center gap-2.5 px-3 py-2 ui-text-menu-item ui-color-error hover:bg-surface-elevated focus-visible:bg-surface-elevated focus-visible:outline-none transition-colors disabled:opacity-50 disabled:pointer-events-none"
            >
              <Trash size={12} aria-hidden="true" />
              <span>
                {t({
                  id: "settings.general.shortcuts.remove_shortcut",
                  message: "Remove shortcut",
                })}
              </span>
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default ShortcutList;
