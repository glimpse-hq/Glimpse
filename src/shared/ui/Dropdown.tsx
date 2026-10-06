import { useLingui } from "@lingui/react/macro";
import { useState, useRef, useEffect, useCallback } from "react";
import {
  CaretDown as ChevronDown,
  MagnifyingGlass as Search,
  Check,
} from "@phosphor-icons/react";
import { useClickOutside } from "../hooks/useClickOutside";
import FloatingPortal from "./FloatingPortal";

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

  useClickOutside(containerRef, closeDropdown, isOpen, [menuRef]);

  useEffect(() => {
    if (disabled) {
      closeDropdown();
    }
  }, [closeDropdown, disabled]);

  useEffect(() => {
    if (!isOpen) return;

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
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
          className={`w-full flex items-center justify-between rounded-lg bg-surface-surface border border-border-primary text-left hover:border-border-secondary focus-within:border-border-hover transition-colors ${buttonClassName || "py-2 px-3 ui-text-body-sm"}`}
          style={{ textAlign: "left" }}
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
                "min-w-0 flex-1 bg-transparent text-left text-content-primary placeholder-content-disabled focus:outline-none",
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
          style={{ textAlign: "left" }}
          className={`w-full flex items-center justify-between rounded-lg bg-surface-surface border border-border-primary text-left hover:border-border-secondary focus:border-border-hover focus:outline-hidden transition-colors disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:border-border-primary ${buttonClassName || "py-2 px-3 ui-text-body-sm"}`}
        >
          <div className="flex min-w-0 flex-1 items-center gap-2 text-left">
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
                  "inline-grid text-left",
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
                <span className="col-start-1 row-start-1 whitespace-nowrap text-left">
                  {selectedOption ? selectedOption.label : resolvedPlaceholder}
                </span>
              </span>
            ) : (
              <span
                className={classNames(
                  "block min-w-0 flex-1 text-left",
                  truncate && "truncate",
                  selectedOption
                    ? "text-content-primary"
                    : "text-content-muted",
                  valueClassName,
                )}
                style={{ textAlign: "left" }}
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

      {isOpen && (
        <FloatingPortal
          anchorRef={containerRef}
          ref={menuRef}
          placement="bottom-start"
          matchAnchorWidth
          className={`ui-surface-menu flex flex-col max-h-[280px] text-left ${menuClassName}`}
          style={{ textAlign: "left" }}
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
                className="w-full bg-transparent border-0 py-2.5 text-left ui-text-body-sm text-content-primary placeholder-content-disabled focus:outline-none"
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
                    style={{ textAlign: "left" }}
                    className={classNames(
                      "mt-1 text-left first:mt-0",
                      option.prominentHeader
                        ? "px-2.5 pt-2 pb-1.5 ui-text-label-strong ui-color-secondary"
                        : "px-2.5 py-1.5 ui-text-uppercase-meta font-semibold ui-color-disabled",
                    )}
                  >
                    <span
                      className="block w-full text-left"
                      style={{ textAlign: "left" }}
                    >
                      {option.label}
                    </span>
                    {option.description && (
                      <p
                        className="mt-0.5 block w-full text-left ui-text-meta font-normal normal-case ui-color-disabled"
                        style={{ textAlign: "left" }}
                      >
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
                    style={{ textAlign: "left" }}
                    onClick={() => {
                      onChange(option.value);
                      closeDropdown();
                    }}
                    className={classNames(
                      "group flex w-full items-start justify-between rounded-md px-2.5 py-2 text-left transition-colors duration-100",
                      option.locked
                        ? "text-content-disabled cursor-default"
                        : value === option.value
                          ? "bg-[var(--color-interactive-10)] text-[var(--color-interactive)]"
                          : "text-content-secondary hover:bg-surface-elevated hover:text-content-primary",
                      optionClassName,
                    )}
                  >
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5 text-left">
                      <span
                        className={classNames(
                          "flex min-w-0 items-start gap-2 text-left",
                          optionLabelClassName,
                        )}
                      >
                        {option.icon && (
                          <span aria-hidden="true" className="shrink-0">
                            {option.icon}
                          </span>
                        )}
                        <span
                          className={classNames(
                            "block min-w-0 flex-1 text-left",
                            truncate && "truncate",
                          )}
                          style={{ textAlign: "left" }}
                        >
                          {option.label}
                        </span>
                      </span>
                      {option.description && (
                        <span
                          className={`block w-full text-left ui-text-meta truncate ${
                            value === option.value
                              ? "text-[var(--color-interactive)] opacity-75"
                              : "ui-color-disabled group-hover:text-content-muted"
                          }`}
                          style={{ textAlign: "left" }}
                        >
                          {option.description}
                        </span>
                      )}
                    </div>
                    <div className="ml-2 mt-0.5 flex shrink-0 items-center gap-2">
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
        </FloatingPortal>
      )}
    </div>
  );
}
