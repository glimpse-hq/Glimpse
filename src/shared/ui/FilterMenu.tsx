import { useRef, useState, type ReactNode } from "react";
import { useLingui } from "@lingui/react/macro";
import { motion, AnimatePresence } from "framer-motion";
import { Check, FunnelSimple } from "@phosphor-icons/react";
import { useClickOutside } from "../hooks/useClickOutside";

export type FilterMenuItem = {
  key: string;
  label: string;
  icon?: ReactNode;
  selected: boolean;
  onSelect: () => void;
};

export type FilterMenuSection = {
  key: string;
  title: string;
  multiple?: boolean;
  items: FilterMenuItem[];
};

type FilterMenuProps = {
  ariaLabel: string;
  sections: FilterMenuSection[];
  active?: boolean;
  onClear?: () => void;
  triggerClassName?: string;
};

const FilterMenu = ({
  ariaLabel,
  sections,
  active = false,
  onClear,
  triggerClassName = "h-7 w-7",
}: FilterMenuProps) => {
  const { t } = useLingui();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(ref, () => setOpen(false), open);

  return (
    <div className="relative shrink-0" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={ariaLabel}
        className={`ui-button-ghost relative ${triggerClassName} ${
          active || open ? "text-content-primary" : ""
        }`}
      >
        <FunnelSimple size={14} aria-hidden="true" />
        {active && (
          <span
            aria-hidden="true"
            className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-local"
          />
        )}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            initial={{ opacity: 0, scale: 0.98, y: -2 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: -2 }}
            transition={{ duration: 0.12 }}
            className="ui-surface-menu absolute right-0 top-full z-30 mt-1.5 min-w-[180px] py-1"
          >
            {sections.map((section, index) => (
              <div key={section.key}>
                {index > 0 && (
                  <div className="mx-3 my-1 border-t border-border-secondary" />
                )}
                <div className="flex items-center justify-between px-3 pb-1 pt-1">
                  <span className="ui-text-uppercase-micro ui-color-muted">
                    {section.title}
                  </span>
                  {index === 0 && onClear && (
                    <button
                      type="button"
                      disabled={!active}
                      onClick={onClear}
                      className="ui-text-micro text-content-muted transition-colors hover:text-content-primary disabled:pointer-events-none disabled:opacity-0"
                    >
                      {t({ id: "filter_menu.clear", message: "Clear" })}
                    </button>
                  )}
                </div>
                {section.items.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    role={
                      section.multiple ? "menuitemcheckbox" : "menuitemradio"
                    }
                    aria-checked={item.selected}
                    onClick={item.onSelect}
                    className={`mx-1 flex w-[calc(100%-0.5rem)] items-center justify-between gap-3 rounded-md px-2 py-1 ui-text-body-sm transition-colors hover:bg-[var(--surface-interactive)] ${
                      item.selected
                        ? "ui-color-primary"
                        : "ui-color-secondary hover:text-content-primary"
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      {item.icon}
                      {item.label}
                    </span>
                    <span className="flex w-3 shrink-0 items-center justify-center">
                      {item.selected && <Check size={12} aria-hidden="true" />}
                    </span>
                  </button>
                ))}
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default FilterMenu;
