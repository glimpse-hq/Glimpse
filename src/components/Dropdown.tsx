
import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown, Search, Check } from "lucide-react";

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
    menuClassName = "",
    onOpen,
}: DropdownProps<T>) {
    const [isOpen, setIsOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");
    const containerRef = useRef<HTMLDivElement>(null);

    const selectedOption = options.find((opt) => opt.value === value);

    useEffect(() => {
        if (isOpen) {
            onOpen?.();
        }
    }, [isOpen]);

    useEffect(() => {
        if (!isOpen) return;

        const handleClickOutside = (event: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                setIsOpen(false);
                setSearchQuery("");
            }
        };

        const handleEscape = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                setIsOpen(false);
                setSearchQuery("");
            }
        };

        document.addEventListener("mousedown", handleClickOutside);
        document.addEventListener("keydown", handleEscape);
        return () => {
            document.removeEventListener("mousedown", handleClickOutside);
            document.removeEventListener("keydown", handleEscape);
        };
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
                <span className="flex items-center gap-1 text-[9px] font-medium uppercase tracking-wide">
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
            <span className="flex items-center gap-1 text-[9px] font-medium uppercase tracking-wide">
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
                onClick={() => setIsOpen(!isOpen)}
                aria-haspopup="listbox"
                aria-expanded={isOpen}
                className="w-full flex items-center justify-between rounded-lg bg-surface-surface border border-border-primary py-2 px-3 text-xs text-left hover:border-border-secondary focus:border-border-hover focus:outline-none transition-colors"
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
                                        className="w-full rounded-md bg-surface-elevated border border-border-secondary py-1.5 pl-7 pr-2.5 text-xs text-content-primary placeholder-content-disabled focus:border-content-disabled focus:outline-none transition-colors"
                                        onClick={(e) => e.stopPropagation()}
                                    />
                                </div>
                            </div>
                        )}

                        <div className="overflow-y-auto min-h-[40px]" role="listbox">
                            {filteredOptions.length > 0 ? (
                                filteredOptions.map((option) => 
                                    option.isHeader ? (
                                        <div
                                            key={option.value}
                                            role="presentation"
                                            className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-content-disabled border-t border-border-secondary first:border-t-0 mt-1 first:mt-0"
                                        >
                                            {option.label}
                                        </div>
                                    ) : (
                                        <button
                                            key={option.value}
                                            type="button"
                                            role="option"
                                            aria-selected={value === option.value}
                                            onClick={() => {
                                                onChange(option.value);
                                                setIsOpen(false);
                                                setSearchQuery("");
                                            }}
                                            className={`w-full text-left px-3 py-2 transition-colors flex items-center justify-between group ${value === option.value
                                                ? "bg-cloud/10 text-cloud"
                                                : "text-content-secondary hover:bg-surface-elevated hover:text-content-primary"
                                                }`}
                                        >
                                            <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                                                <span className="text-[12px] font-medium truncate flex items-center gap-2">
                                                    {option.icon && <span aria-hidden="true">{option.icon}</span>}
                                                    {option.label}
                                                </span>
                                                {option.description && (
                                                    <span className={`text-[10px] truncate ${value === option.value ? "text-cloud/70" : "text-content-disabled group-hover:text-content-muted"
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
                                <div className="px-3 py-4 text-xs text-content-muted text-center">
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
