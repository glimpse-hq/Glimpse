import type { ReactNode } from "react";

interface ScreenHeaderProps {
  icon: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  titleAdornment?: ReactNode;
  trailing?: ReactNode;
  className?: string;
}

// One block on every screen: marker, title over a one-line description, and
// the screen's tools on the right (search, icon menus, one primary action
// last, all h-8). Tools share this row; screens do not add a toolbar row.
export function ScreenHeader({
  icon,
  title,
  description,
  titleAdornment,
  trailing,
  className = "",
}: ScreenHeaderProps) {
  return (
    <header className={`mt-2 mb-5 shrink-0 md:-mt-6 ${className}`}>
      <div className="flex min-w-0 items-center gap-3.5">
        <span className="flex shrink-0 self-start pt-[9px]">{icon}</span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <h2 className="min-w-0 truncate ui-text-screen-title ui-color-primary tracking-tight">
              {title}
            </h2>
            {titleAdornment}
          </div>
          {description ? (
            <p className="truncate ui-text-body-sm ui-color-muted">
              {description}
            </p>
          ) : null}
        </div>
        {trailing ? (
          <div className="flex shrink-0 items-center gap-2">{trailing}</div>
        ) : null}
      </div>
      <div
        className="mt-3 h-px w-full"
        style={{
          background:
            "linear-gradient(to right, transparent, var(--border-subtle) 8%, var(--border-subtle) 92%, transparent)",
        }}
      />
    </header>
  );
}

export default ScreenHeader;
