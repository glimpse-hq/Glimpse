import type { ReactNode } from "react";

interface ScreenHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  titleAdornment?: ReactNode;
  trailing?: ReactNode;
  className?: string;
}

// One block on every screen: the title on the window's title line
// with the screen's tools (search, icon menus, one primary action last, all
// h-8), then an optional line of facts. Screens do not add a toolbar row.
export function ScreenHeader({
  title,
  description,
  titleAdornment,
  trailing,
  className = "",
}: ScreenHeaderProps) {
  return (
    <header className={`mb-5 shrink-0 ${className}`}>
      <div className="flex min-w-0 items-start gap-3.5">
        <div className="min-w-0 flex-1">
          <div className="flex h-8 min-w-0 items-center gap-2">
            <h2 className="min-w-0 truncate ui-text-screen-title ui-color-primary tracking-tight">
              {title}
            </h2>
            {titleAdornment}
          </div>
          {description ? (
            <div className="min-w-0 ui-text-body-sm ui-color-muted">
              {description}
            </div>
          ) : null}
        </div>
        {trailing ? (
          <div className="flex h-8 shrink-0 items-center gap-2">{trailing}</div>
        ) : null}
      </div>
      <ScreenHeaderRule />
    </header>
  );
}

// The hairline under a screen header, for headers that can't use ScreenHeader.
export function ScreenHeaderRule() {
  return (
    <div
      className="mt-3 h-px w-full"
      style={{
        background:
          "linear-gradient(to right, transparent, var(--border-subtle) 8%, var(--border-subtle) 92%, transparent)",
      }}
    />
  );
}

export default ScreenHeader;
