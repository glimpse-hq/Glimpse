import { useLingui } from "@lingui/react/macro";
import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FolderOpen, Plus, Trash } from "@phosphor-icons/react";
import { useShiftHeld } from "../../../shared/hooks/useShiftHeld";
import { useMenuKeyboard } from "../../../shared/hooks/useMenuKeyboard";
import NameDialog from "../../../shared/ui/NameDialog";
import ScreenHeader from "../../../shared/ui/ScreenHeader";
import ToggleSwitch from "../../../shared/ui/ToggleSwitch";
import { showErrorToast } from "../../../shared/lib/errorToast";
import { formatShortcutForDisplay } from "../../../shared/lib/shortcuts";
import { detectAppPlatform } from "../../../platform/service";
import {
  createActionFile,
  openActionsFolder,
  revealActionFile,
  trashActionFile,
} from "../api";
import { useActions, useSetActionEnabled } from "../queries";
import type { ActionInfo } from "../../../types";

const isWindows = detectAppPlatform() === "windows";

const ActionsView = ({ isActive }: { isActive: boolean }) => {
  const { t } = useLingui();
  const { data, error } = useActions(isActive, true);
  const setEnabled = useSetActionEnabled();
  const shiftHeld = useShiftHeld(isActive);
  const [menu, setMenu] = useState<{
    file: string;
    x: number;
    y: number;
  } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  useMenuKeyboard(menuRef, menu !== null, () => setMenu(null));
  const [creating, setCreating] = useState(false);

  const reveal = (file: string) =>
    void revealActionFile(file).catch((err) => showErrorToast(String(err)));
  const trash = (file: string) =>
    void trashActionFile(file).catch((err) => showErrorToast(String(err)));
  const moveToTrashLabel = isWindows
    ? t({ id: "actions.delete", message: "Delete" })
    : t({ id: "actions.move_to_trash", message: "Move to Trash" });
  const showInFinderLabel = isWindows
    ? t({ id: "actions.show_in_explorer", message: "Show in File Explorer" })
    : t({ id: "actions.show_in_finder", message: "Show in Finder" });

  const eventLabels: Record<string, string> = {
    "dictation.saved": t({
      id: "actions.event.dictation_saved",
      message: "After each dictation",
    }),
    "library.added": t({
      id: "actions.event.library_added",
      message: "When a recording is added",
    }),
    "library.complete": t({
      id: "actions.event.library_complete",
      message: "When a recording is ready",
    }),
    "library.error": t({
      id: "actions.event.library_error",
      message: "When a recording fails",
    }),
  };

  const runByNameLabel = t({
    id: "actions.trigger.none",
    message: "Run by name",
  });
  const triggers = (action: ActionInfo) => [
    ...action.shortcuts.map(({ shortcut }) => ({
      key: true,
      label: formatShortcutForDisplay(shortcut, { symbols: true }),
    })),
    ...action.phrases.map((phrase) => ({ key: false, label: `“${phrase}”` })),
    ...action.events.map((event) => ({
      key: false,
      label: eventLabels[event] ?? event,
    })),
  ];

  const openFolder = () =>
    void openActionsFolder().catch((err) => showErrorToast(String(err)));
  const create = (name: string) =>
    createActionFile(name).then(() => setCreating(false));
  // Without an extension of its own, the file gets the platform's script type.
  const scriptSuffix = (name: string) =>
    name.lastIndexOf(".") > 0 ? null : isWindows ? ".ps1" : ".sh";
  const newActionLabel = t({ id: "actions.new", message: "New Action" });

  return (
    <div className="flex h-full min-h-0 w-full flex-col text-left">
      <ScreenHeader
        title={t({ id: "actions.title", message: "Actions" })}
        trailing={
          <div className="flex h-8 shrink-0 gap-px">
            <button
              type="button"
              onClick={openFolder}
              className="ui-button-primary inline-flex items-center whitespace-nowrap rounded-l-lg px-5 ui-text-body-sm"
            >
              {t({ id: "actions.open_folder", message: "Open Folder" })}
            </button>
            <button
              type="button"
              onClick={() => setCreating(true)}
              aria-label={newActionLabel}
              title={newActionLabel}
              className="ui-button-primary inline-flex w-8 items-center justify-center rounded-r-lg"
            >
              <Plus size={13} weight="bold" aria-hidden="true" />
            </button>
          </div>
        }
      />

      <div className="-mt-1 min-h-0 flex-1 overflow-x-hidden custom-scrollbar column-scroll pt-1 pb-6">
        {error ? (
          <p className="py-16 text-center ui-text-body ui-color-error-soft">
            {String(error)}
          </p>
        ) : data?.actions.length === 0 ? (
          <button
            type="button"
            onClick={openFolder}
            className="w-full py-16 text-center ui-text-body ui-color-muted transition-colors hover:text-content-secondary"
          >
            {t({
              id: "actions.empty",
              message: "Add a script to the Actions folder.",
            })}
          </button>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {data?.actions.map((action) => {
              const issue = action.problems[0] ?? action.last_failure;
              return (
                <div
                  key={action.file}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    setMenu({
                      file: action.file,
                      x: event.clientX,
                      y: event.clientY,
                    });
                  }}
                  className={`ui-card-liftable group relative flex flex-col px-5 py-4 has-[>button:focus-visible]:ring-1 has-[>button:focus-visible]:ring-border-hover ${
                    shiftHeld
                      ? "!border-red-500/30 hover:!border-red-500/60 hover:!bg-red-500/5"
                      : ""
                  }`}
                >
                  <button
                    type="button"
                    aria-label={action.name}
                    title={shiftHeld ? moveToTrashLabel : showInFinderLabel}
                    onClick={() =>
                      shiftHeld ? trash(action.file) : reveal(action.file)
                    }
                    className="absolute inset-0 rounded-[inherit] focus-visible:outline-none"
                  />
                  <div className="pointer-events-none relative flex flex-col">
                    <div className="flex h-6 items-center justify-between gap-3">
                      <p
                        className={`truncate ui-text-body-lg-strong ${
                          action.enabled ? "ui-color-primary" : "ui-color-muted"
                        }`}
                      >
                        {action.name}
                      </p>
                      <div className="pointer-events-auto shrink-0">
                        <ToggleSwitch
                          enabled={action.enabled}
                          ariaLabel={action.name}
                          onToggle={() =>
                            setEnabled.mutate({
                              file: action.file,
                              enabled: !action.enabled,
                            })
                          }
                        />
                      </div>
                    </div>
                    <p
                      className={`mt-0.5 truncate ui-color-secondary ${
                        action.enabled ? "" : "opacity-60"
                      }`}
                    >
                      {triggers(action).map((trigger, index) => (
                        <span key={trigger.label}>
                          {index > 0 && (
                            <span className="ui-text-body-sm ui-color-muted">
                              {" · "}
                            </span>
                          )}
                          <span
                            className={
                              trigger.key ? "ui-text-kbd" : "ui-text-body-sm"
                            }
                          >
                            {trigger.label}
                          </span>
                        </span>
                      ))}
                      {triggers(action).length === 0 && (
                        <span className="ui-text-body-sm ui-color-muted">
                          {runByNameLabel}
                        </span>
                      )}
                    </p>
                    <p
                      title={
                        issue
                          ? action.problems.join("\n") || issue
                          : (action.description ?? undefined)
                      }
                      className={`mt-2 line-clamp-2 min-h-[1lh] ui-text-body-sm ${
                        issue
                          ? "ui-color-warning"
                          : `ui-color-muted ${action.enabled ? "" : "opacity-60"}`
                      }`}
                    >
                      {issue ?? action.description}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <NameDialog
        open={creating}
        title={newActionLabel}
        submitLabel={t({ id: "actions.new.create", message: "Create" })}
        cancelLabel={t({ id: "actions.new.cancel", message: "Cancel" })}
        suffix={scriptSuffix}
        onCancel={() => setCreating(false)}
        onSubmit={create}
      />

      {menu &&
        createPortal(
          <>
            <div
              className="fixed inset-0 z-[110]"
              onClick={() => setMenu(null)}
              onContextMenu={(event) => {
                event.preventDefault();
                setMenu(null);
              }}
            />
            <div
              ref={menuRef}
              role="menu"
              className="ui-surface-menu fixed z-[120] min-w-[184px] py-1"
              style={{
                left: Math.min(menu.x, window.innerWidth - 200),
                top: Math.min(menu.y, window.innerHeight - 96),
              }}
            >
              {[
                {
                  label: showInFinderLabel,
                  icon: <FolderOpen size={12} className="ui-color-muted" />,
                  run: () => reveal(menu.file),
                  destructive: false,
                },
                {
                  label: moveToTrashLabel,
                  icon: <Trash size={12} />,
                  run: () => trash(menu.file),
                  destructive: true,
                },
              ].map((item) => (
                <button
                  key={item.label}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    item.run();
                    setMenu(null);
                  }}
                  className={`flex w-full items-center gap-2.5 px-3 py-2 ui-text-menu-item transition-colors hover:bg-surface-elevated focus-visible:bg-surface-elevated focus-visible:outline-none ${
                    item.destructive ? "ui-color-error" : "ui-color-secondary"
                  }`}
                >
                  <span aria-hidden="true" className="flex">
                    {item.icon}
                  </span>
                  <span>{item.label}</span>
                </button>
              ))}
            </div>
          </>,
          document.body,
        )}
    </div>
  );
};

export default ActionsView;
