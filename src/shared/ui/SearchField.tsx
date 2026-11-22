import { useLingui } from "@lingui/react/macro";
import type { KeyboardEvent, ReactNode, RefObject } from "react";
import { MagnifyingGlass, X } from "@phosphor-icons/react";

// The search box for screens whose content is a list to search. Escape
// clears it, then leaves it.
export function SearchField({
  value,
  onChange,
  placeholder,
  inputRef,
  onKeyDown,
  trailing,
  className = "w-56",
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  inputRef?: RefObject<HTMLInputElement | null>;
  onKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void;
  // Shown inside the box before the clear button, e.g. a match count.
  trailing?: ReactNode;
  className?: string;
}) {
  const { t } = useLingui();
  return (
    <div
      className={`flex h-8 min-w-0 items-center gap-2 rounded-lg border border-[var(--color-border-primary)] bg-[var(--color-bg-surface)] pl-2.5 pr-1.5 transition-colors duration-100 ease-out focus-within:border-[var(--color-border-hover)] ${className}`}
    >
      <MagnifyingGlass
        size={13}
        className="shrink-0 ui-color-muted"
        aria-hidden="true"
      />
      <input
        ref={inputRef}
        type="text"
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        {...{ writingsuggestions: "false" }}
        placeholder={placeholder}
        aria-label={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          onKeyDown?.(event);
          if (event.defaultPrevented || event.key !== "Escape") return;
          // Handled here, so the screen's own Escape doesn't also run.
          event.preventDefault();
          if (value) onChange("");
          else event.currentTarget.blur();
        }}
        className="min-w-0 flex-1 bg-transparent ui-text-body-sm ui-color-primary placeholder-[var(--color-text-muted)] outline-none"
      />
      {trailing}
      {value && (
        <button
          type="button"
          onClick={() => {
            onChange("");
            inputRef?.current?.focus();
          }}
          aria-label={t({ id: "search_field.clear", message: "Clear search" })}
          className="shrink-0 rounded p-0.5 text-content-disabled transition-colors hover:text-content-muted"
        >
          <X size={12} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

export default SearchField;
