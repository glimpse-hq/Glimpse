import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown, Search, Check } from "lucide-react";
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
    onOpen?: () => void;
}

export function Dropdown<T extends string | number>({
    value,
    onChange,
    options,
    placeholder = "Select...",
    label,
    icon,
    searchable = false,
    searchPlaceholder = "Search...",
    className = "",
    buttonClassName,
    menuClassName = "",
    onOpen,
}: DropdownProps<T>) {
    const [isOpen, setIsOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");
    const containerRef = useRef<HTMLDivElement>(null);

    const selectedOption = options.find((opt) => opt.value === value);
    const closeDropdown = useCallback(() => {
        setIsOpen(false);
        setSearchQuery("");
    }, []);

    useClickOutside(containerRef, closeDropdown, isOpen);

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
            // Only show header if there are options after it that match the search
            for (let i = idx + 1; i < options.length; i++) {
                if (options[i].isHeader) break;
                if (matchesSearch(options[i])) return true;
            }
            return false;
        })
        : options;

    const renderBadges = (
        badges?: DropdownOption<T>["badges"],
        fixedBadgeSlots?: boolean
    ) => {
        if (!badges || badges.length === 0) return null;

        if (fixedBadgeSlots) {
            return (
                <span className="flex items-center gap-1 ui-text-uppercase-micro font-medium">
                    {badges.map((badge, index) => (
                        <span
                            key={`${badge.label}-${index}`}
                            className={`w-5 text-right ${badge.visible === false
                                ? "text-transparent"
                                : badge.highlighted
                                    ? "text-cloud"
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
                {badges.map((badge, index) => (
                    badge.visible === false ? null : (
                        <span
                            key={`${badge.label}-${index}`}
                            className={badge.highlighted ? "text-cloud" : "text-content-disabled"}
                        >
                            {badge.label}
                        </span>
                    )
                ))}
            </span>
        );
    };

    return (
        <div className={`relative ${className}`} ref={containerRef}>
            <button
                type="button"
                onClick={() => {
                    if (isOpen) {
                        closeDropdown();
                    } else {
                        onOpen?.();
                        setIsOpen(true);
                    }
                }}
                aria-haspopup="listbox"
                aria-expanded={isOpen}
                className={`w-full flex items-center justify-between rounded-lg bg-surface-surface border border-border-primary text-left hover:border-border-secondary focus:border-border-hover focus:outline-hidden transition-colors ${buttonClassName || "py-2 px-3 ui-text-body-sm"}`}
            >
                <div className="flex items-center gap-2 min-w-0">
                    {icon && <span className="text-content-muted shrink-0" aria-hidden="true">{icon}</span>}
                    {label && <span className="text-content-muted shrink-0">{label}</span>}
                    <span className={`truncate ${selectedOption ? "text-content-primary" : "text-content-muted"}`}>
                        {selectedOption ? selectedOption.label : placeholder}
                    </span>
                </div>
                <div className="flex items-center gap-2 shrink-0 ml-2">
                    {renderBadges(selectedOption?.badges, selectedOption?.fixedBadgeSlots)}
                    <ChevronDown
                        size={14}
                        aria-hidden="true"
                        className={`text-content-muted transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
                    />
                </div>
            </button>

            <AnimatePresence>
                {isOpen && (
                    <motion.div
                        initial={{ opacity: 0, y: -4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -4 }}
                        transition={{ duration: 0.15 }}
                        className={`absolute left-0 right-0 top-full mt-1 z-[9999] rounded-lg border border-border-secondary bg-surface-surface shadow-xl shadow-black/40 overflow-hidden flex flex-col max-h-[280px] ${menuClassName}`}
                    >
                        {searchable && (
                            <div className="p-2 border-b border-border-secondary shrink-0">
                                <div className="relative">
                                    <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-content-disabled" aria-hidden="true" />
                                    <input
                                        type="text"
                                        value={searchQuery}
                                        onChange={(e) => setSearchQuery(e.target.value)}
                                        placeholder={searchPlaceholder}
                                        aria-label="Search options"
                                        autoFocus
                                        className="w-full rounded-md bg-surface-elevated border border-border-secondary py-1.5 pl-7 pr-2.5 ui-text-body-sm ui-color-primary placeholder-content-disabled focus:border-content-disabled focus:outline-hidden transition-colors"
                                        onClick={(e) => e.stopPropagation()}
                                    />
                                </div>
                            </div>
                        )}

                        <div className="overflow-y-auto min-h-[40px]" role="listbox">
                            {filteredOptions.length > 0 ? (
                                filteredOptions.map((option, idx) =>
                                    option.isHeader ? (
                                        <div
                                            key={`header-${idx}-${option.value}`}
                                            role="presentation"
                                            className="px-3 py-1.5 ui-text-uppercase-meta font-semibold ui-color-disabled border-t border-border-secondary first:border-t-0 mt-1 first:mt-0"
                                        >
                                            {option.label}
                                        </div>
                                    ) : (
                                        <button
                                            key={`opt-${idx}-${option.value}`}
                                            type="button"
                                            role="option"
                                            aria-selected={value === option.value}
                                            onClick={() => {
                                                onChange(option.value);
                                                closeDropdown();
                                            }}
                                            className={`w-full text-left px-3 py-2 transition-colors flex items-center justify-between group ${value === option.value
                                                ? "bg-cloud/10 text-cloud"
                                                : "text-content-secondary hover:bg-surface-elevated hover:text-content-primary"
                                                }`}
                                        >
                                            <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                                                <span className="ui-text-body-sm-strong flex min-w-0 items-center gap-2">
                                                    {option.icon && <span aria-hidden="true" className="shrink-0">{option.icon}</span>}
                                                    <span className="truncate">{option.label}</span>
                                                </span>
                                                {option.description && (
                                                    <span className={`ui-text-meta truncate ${value === option.value ? "text-cloud/70" : "ui-color-disabled group-hover:text-content-muted"
                                                        }`}>
                                                        {option.description}
                                                    </span>
                                                )}
                                            </div>
                                            <div className="shrink-0 ml-2 flex items-center gap-2">
                                                {renderBadges(option.badges, option.fixedBadgeSlots)}
                                                <span className="h-3 w-3 flex items-center justify-center">
                                                    {value === option.value && <Check size={12} aria-hidden="true" />}
                                                </span>
                                            </div>
                                        </button>
                                    )
                                )
                            ) : (
                                <div className="px-3 py-4 ui-text-body-sm ui-color-muted text-center">
                                    No options found
                                </div>
                            )}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
