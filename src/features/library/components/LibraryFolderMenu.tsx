import { useLingui } from "@lingui/react/macro";
import { useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CaretDown, Check } from "@phosphor-icons/react";
import { useClickOutside } from "../../../shared/hooks/useClickOutside";
import { useMenuKeyboard } from "../../../shared/hooks/useMenuKeyboard";

const itemClass =
  "mx-1 flex w-[calc(100%-0.5rem)] items-center justify-between gap-3 rounded-md px-2 py-1 ui-text-body-sm transition-colors hover:bg-[var(--surface-interactive)]";

// Opens beside the Library title: All, each folder, and the open folder's
// actions.
const LibraryFolderMenu = ({
  folders,
  folder,
  onSelect,
  onRename,
  onDelete,
  onNew,
}: {
  folders: string[];
  folder: string | null;
  onSelect: (folder: string | null) => void;
  onRename: (folder: string) => void;
  onDelete: (folder: string) => void;
  onNew: () => void;
}) => {
  const { t } = useLingui();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  useClickOutside(ref, () => setOpen(false), open);
  useMenuKeyboard(menuRef, open, () => setOpen(false));

  const choose = (next: string | null) => {
    setOpen(false);
    onSelect(next);
  };
  const entries: { key: string; label: string; value: string | null }[] = [
    {
      key: "all",
      label: t({ id: "library.folder.all", message: "All Items" }),
      value: null,
    },
    ...folders.map((name) => ({ key: name, label: name, value: name })),
  ];

  return (
    <div className="relative shrink-0" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t({ id: "library.folder.menu", message: "Folders" })}
        className={`ui-button-ghost h-7 w-7 ${open ? "text-content-primary" : ""}`}
      >
        <CaretDown size={13} aria-hidden="true" />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            ref={menuRef}
            role="menu"
            initial={{ opacity: 0, scale: 0.98, y: -2 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: -2 }}
            transition={{ duration: 0.12 }}
            className="ui-surface-menu absolute left-0 top-full z-30 mt-1.5 max-h-[360px] min-w-[200px] overflow-y-auto py-1 custom-scrollbar"
          >
            {entries.map((entry) => (
              <button
                key={entry.key}
                type="button"
                role="menuitemradio"
                aria-checked={entry.value === folder}
                onClick={() => choose(entry.value)}
                className={`${itemClass} ${
                  entry.value === folder
                    ? "ui-color-cloud"
                    : "ui-color-secondary hover:text-content-primary"
                }`}
              >
                <span className="min-w-0 truncate">{entry.label}</span>
                <span className="flex w-3 shrink-0 items-center justify-center">
                  {entry.value === folder && (
                    <Check size={12} aria-hidden="true" />
                  )}
                </span>
              </button>
            ))}
            <div className="mx-3 my-1 border-t border-border-secondary" />
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onNew();
              }}
              className={`${itemClass} ui-color-secondary hover:text-content-primary`}
            >
              {t({ id: "library.folder.new", message: "New Folder..." })}
            </button>
            {folder && (
              <>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setOpen(false);
                    onRename(folder);
                  }}
                  className={`${itemClass} ui-color-secondary hover:text-content-primary`}
                >
                  {t({
                    id: "library.folder.rename",
                    message: "Rename Folder...",
                  })}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setOpen(false);
                    onDelete(folder);
                  }}
                  className={`${itemClass} ui-color-error-strong`}
                >
                  {t({ id: "library.folder.delete", message: "Delete Folder" })}
                </button>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default LibraryFolderMenu;
