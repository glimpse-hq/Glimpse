import { useLingui } from "@lingui/react/macro";
import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  CaretDown as ChevronDown,
  MagnifyingGlass as Search,
  Check,
} from "@phosphor-icons/react";
import { useClickOutside } from "../hooks/useClickOutside";

export interface DropdownOption<T extends string | number> {
  value: T;
  label: string;
  description?: string;
  icon?: React.ReactNode;
  badges?: Array<{
    label: string;
    highlighted?: boolean;
    visible?: boolean;
  }>;
  fixedBadgeSlots?: boolean;
  isHeader?: boolean;
  prominentHeader?: boolean;
  locked?: boolean;
}

interface DropdownProps<T extends string | number> {
  value: T | null;
  onChange: (value: T) => void;
  options: DropdownOption<T>[];
  placeholder?: string;
  label?: string;
  icon?: React.ReactNode;
  searchable?: boolean;
  searchPlaceholder?: string;
  className?: string;
  buttonClassName?: string;
  menuClassName?: string;
  valueClassName?: string;
  optionClassName?: string;
  optionLabelClassName?: string;
  onOpen?: () => void;
  onOpenChange?: (open: boolean) => void;
  disabled?: boolean;
  truncate?: boolean;
  fitButtonToWidestOption?: boolean;
  hideChevron?: boolean;
  editableInput?: {
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
    ariaLabel?: string;
  };
}

const classNames = (...classes: Array<string | false | null | undefined>) =>
  classes.filter(Boolean).join(" ");

export function Dropdown<T extends string | number>({
  value,
  onChange,
  options,
  placeholder,
  label,
  icon,
  searchable = false,
  searchPlaceholder,
  className = "",
  buttonClassName,
  menuClassName = "",
  valueClassName = "",
  optionClassName = "",
  optionLabelClassName = "ui-text-body-sm-strong",
  onOpen,
  onOpenChange,
  disabled = false,
  truncate = true,
  fitButtonToWidestOption = false,
  hideChevron = false,
  editableInput,
}: DropdownProps<T>) {
  const { t } = useLingui();
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [openUpward, setOpenUpward] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const resolvedPlaceholder =
    placeholder ??
    t({
      id: "dropdown.placeholder",
      message: "Select...",
    });
  const resolvedSearchPlaceholder =
    searchPlaceholder ??
    t({
      id: "dropdown.search_placeholder",
      message: "Search...",
    });

  const selectedOption = options.find((opt) => opt.value === value);
  const closeDropdown = useCallback(() => {
    setIsOpen(false);
    setSearchQuery("");
  }, []);

  useClickOutside(containerRef, closeDropdown, isOpen);

  useEffect(() => {
    if (disabled) {
      closeDropdown();
    }
  }, [closeDropdown, disabled]);

  useEffect(() => {
    if (!isOpen) return;

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeDropdown();
      }
    };

    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("keydown", handleEscape);
    };
  }, [closeDropdown, isOpen]);

  useEffect(() => {
    onOpenChange?.(isOpen);
  }, [isOpen, onOpenChange]);

  useEffect(() => {
    if (!isOpen || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const menuHeight = menuRef.current?.offsetHeight ?? 0;
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    setOpenUpward(spaceBelow < menuHeight && spaceAbove > spaceBelow);
  }, [isOpen]);

  const query = searchQuery.trim().toLowerCase();

  const matchesSearch = (opt: DropdownOption<T>) =>
    !query ||
    opt.label.toLowerCase().includes(query) ||
    opt.description?.toLowerCase().includes(query);

  const filteredOptions = searchable
    ? options.filter((opt, idx) => {
        if (!opt.isHeader) {
          return matchesSearch(opt);
        }
        for (let i = idx + 1; i < options.length; i++) {
          if (options[i].isHeader) break;
          if (matchesSearch(options[i])) return true;
        }
        return false;
      })
    : options;

  const selectableOptions = options.filter((option) => !option.isHeader);
  const buttonWidthLabels = fitButtonToWidestOption
    ? [
        ...selectableOptions.map((option) => option.label),
        ...(value === null ? [resolvedPlaceholder] : []),
      ]
    : [];

  const renderBadges = (
    badges?: DropdownOption<T>["badges"],
    fixedBadgeSlots?: boolean,
  ) => {
    if (!badges || badges.length === 0) return null;

    if (fixedBadgeSlots) {
      return (
        <span className="flex items-center gap-1 ui-text-uppercase-micro font-medium">
          {badges.map((badge, index) => (
            <span
              key={`${badge.label}-${index}`}
              className={`w-4 text-right ${
                badge.visible === false
                  ? "text-transparent"
                  : badge.highlighted
                    ? "text-[var(--color-interactive)]"
                    : "text-content-disabled"
              }`}
            >
              {badge.label}
            </span>
          ))}
        </span>
      );
    }

    return (
      <span className="flex items-center gap-1 ui-text-uppercase-micro font-medium">
        {badges.map((badge, index) =>
          badge.visible === false ? null : (
            <span
              key={`${badge.label}-${index}`}
              className={
                badge.highlighted
                  ? "text-[var(--color-interactive)]"
                  : "text-content-disabled"
              }
            >
              {badge.label}
            </span>
          ),
        )}
      </span>
    );
  };

  const toggleOpen = () => {
    if (disabled) return;
    if (isOpen) {
      closeDropdown();
    } else {
      onOpen?.();
      setIsOpen(true);
    }
  };

  return (
    <div
      className={classNames("relative", isOpen && "z-dropdown-open", className)}
      ref={containerRef}
    >
      {editableInput ? (
        <div
          className={`w-full flex items-center justify-between rounded-lg bg-surface-surface border border-border-primary hover:border-border-secondary focus-within:border-border-hover transition-colors ${buttonClassName || "py-2 px-3 ui-text-body-sm"}`}
        >
          <div className="flex items-center gap-2 min-w-0 flex-1">
            {icon && (
              <span className="text-content-muted shrink-0" aria-hidden="true">
                {icon}
              </span>
            )}
            {label && (
              <span className="text-content-muted shrink-0">{label}</span>
            )}
            <input
              type="text"
              value={editableInput.value}
              onChange={(e) => editableInput.onChange(e.target.value)}
              placeholder={editableInput.placeholder}
              aria-label={editableInput.ariaLabel}
              className={classNames(
                "min-w-0 flex-1 bg-transparent text-content-primary placeholder-content-disabled focus:outline-none",
                valueClassName,
              )}
            />
          </div>
          <button
            type="button"
            onClick={toggleOpen}
            disabled={disabled}
            aria-haspopup="listbox"
            aria-expanded={isOpen}
            aria-label={t({
              id: "dropdown.toggle_menu",
              message: "Toggle options",
            })}
            className="shrink-0 ml-2 inline-flex items-center justify-center text-content-muted hover:text-content-primary disabled:opacity-60"
          >
            <ChevronDown
              size={14}
              aria-hidden="true"
              className={`transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
            />
          </button>
        </div>
      ) : (
        <button
          type="button"
          disabled={disabled}
          onClick={toggleOpen}
          aria-haspopup="listbox"
          aria-expanded={isOpen}
          aria-disabled={disabled}
          className={`w-full flex items-center justify-between rounded-lg bg-surface-surface border border-border-primary text-left hover:border-border-secondary focus:border-border-hover focus:outline-hidden transition-colors disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:border-border-primary ${buttonClassName || "py-2 px-3 ui-text-body-sm"}`}
        >
          <div className="flex items-center gap-2 min-w-0 flex-1">
            {icon && (
              <span className="text-content-muted shrink-0" aria-hidden="true">
                {icon}
              </span>
            )}
            {label && (
              <span className="text-content-muted shrink-0">{label}</span>
            )}
            {fitButtonToWidestOption ? (
              <span
                className={classNames(
                  "inline-grid",
                  selectedOption
                    ? "text-content-primary"
                    : "text-content-muted",
                  valueClassName,
                )}
              >
                {buttonWidthLabels.map((label, index) => (
                  <span
                    key={`${label}-${index}`}
                    className="invisible col-start-1 row-start-1 whitespace-nowrap"
                    aria-hidden="true"
                  >
                    {label}
                  </span>
                ))}
                <span className="col-start-1 row-start-1 whitespace-nowrap">
                  {selectedOption ? selectedOption.label : resolvedPlaceholder}
                </span>
              </span>
            ) : (
              <span
                className={classNames(
                  truncate && "truncate",
                  selectedOption
                    ? "text-content-primary"
                    : "text-content-muted",
                  valueClassName,
                )}
              >
                {selectedOption ? selectedOption.label : resolvedPlaceholder}
              </span>
            )}
          </div>
          <div
            className={classNames(
              "flex items-center gap-2 shrink-0",
              !hideChevron && "ml-2",
            )}
          >
            {renderBadges(
              selectedOption?.badges,
              selectedOption?.fixedBadgeSlots,
            )}
            {!hideChevron && (
              <ChevronDown
                size={14}
                aria-hidden="true"
                className={`text-content-muted transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
              />
            )}
          </div>
        </button>
      )}

      <AnimatePresence>
        {isOpen && (
          <motion.div
            ref={menuRef}
            initial={{ opacity: 0, y: openUpward ? 4 : -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: openUpward ? 4 : -4 }}
            transition={{ duration: 0.15 }}
            className={`ui-surface-menu absolute left-0 right-0 flex flex-col max-h-[280px] ${openUpward ? "bottom-full mb-1" : "top-full mt-1"} ${menuClassName}`}
          >
            {searchable && (
              <div className="flex items-center gap-2 px-3 border-b border-border-secondary shrink-0">
                <Search
                  size={13}
                  className="shrink-0 text-content-disabled"
                  aria-hidden="true"
                />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={resolvedSearchPlaceholder}
                  aria-label={t({
                    id: "dropdown.search_aria",
                    message: "Search options",
                  })}
                  autoFocus
                  className="w-full bg-transparent border-0 py-2.5 ui-text-body-sm text-content-primary placeholder-content-disabled focus:outline-none"
                  onClick={(e) => e.stopPropagation()}
                />
              </div>
            )}

            <div
              className="overflow-y-scroll min-h-[40px] py-1.5 pl-1.5 pr-0 flex flex-col gap-1"
              role="listbox"
            >
              {filteredOptions.length > 0 ? (
                filteredOptions.map((option, idx) =>
                  option.isHeader ? (
                    <div
                      key={`header-${idx}-${option.value}`}
                      role="presentation"
                      className={classNames(
                        "mt-1 first:mt-0",
                        option.prominentHeader
                          ? "px-2.5 pt-2 pb-1.5 ui-text-label-strong ui-color-secondary"
                          : "px-2.5 py-1.5 ui-text-uppercase-meta font-semibold ui-color-disabled",
                      )}
                    >
                      {option.label}
                      {option.description && (
                        <p className="ui-text-meta ui-color-disabled font-normal normal-case mt-0.5">
                          {option.description}
                        </p>
                      )}
                    </div>
                  ) : (
                    <button
                      key={`opt-${idx}-${option.value}`}
                      type="button"
                      role="option"
                      aria-selected={value === option.value}
                      disabled={option.locked}
                      onClick={() => {
                        onChange(option.value);
                        closeDropdown();
                      }}
                      className={classNames(
                        "w-full text-left rounded-md px-2.5 py-2 transition-colors duration-100 flex items-center justify-between group",
                        option.locked
                          ? "text-content-disabled cursor-default"
                          : value === option.value
                            ? "bg-[var(--color-interactive-10)] text-[var(--color-interactive)]"
                            : "text-content-secondary hover:bg-surface-elevated hover:text-content-primary",
                        optionClassName,
                      )}
                    >
                      <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                        <span
                          className={classNames(
                            "flex min-w-0 items-center gap-2",
                            optionLabelClassName,
                          )}
                        >
                          {option.icon && (
                            <span aria-hidden="true" className="shrink-0">
                              {option.icon}
                            </span>
                          )}
                          <span className={classNames(truncate && "truncate")}>
                            {option.label}
                          </span>
                        </span>
                        {option.description && (
                          <span
                            className={`ui-text-meta truncate ${
                              value === option.value
                                ? "text-[var(--color-interactive)] opacity-75"
                                : "ui-color-disabled group-hover:text-content-muted"
                            }`}
                          >
                            {option.description}
                          </span>
                        )}
                      </div>
                      <div className="shrink-0 ml-2 flex items-center gap-2">
                        {renderBadges(option.badges, option.fixedBadgeSlots)}
                        <span className="h-3 w-3 flex items-center justify-center">
                          {!option.locked && value === option.value && (
                            <Check size={12} aria-hidden="true" />
                          )}
                        </span>
                      </div>
                    </button>
                  ),
                )
              ) : (
                <div className="px-3 py-4 ui-text-body-sm ui-color-muted text-center">
                  {t({
                    id: "dropdown.no_options",
                    message: "No options found",
                  })}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
