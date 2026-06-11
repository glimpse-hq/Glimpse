import type { ReactNode } from "react";

interface ScreenHeaderProps {
  icon: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  titleAdornment?: ReactNode;
  trailing?: ReactNode;
  className?: string;
}

export function ScreenHeader({
  icon,
  title,
  description,
  titleAdornment,
  trailing,
  className = "",
}: ScreenHeaderProps) {
  return (
    <header className={className}>
      <div className="flex min-w-0 items-start gap-3.5">
        <span className="flex shrink-0 items-start pt-1.5">{icon}</span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <h2 className="ui-text-screen-title ui-color-primary tracking-tight text-balance">
              {title}
            </h2>
            {titleAdornment}
          </div>
          {description ? (
            <p className="mt-1 ui-text-body-sm ui-color-secondary text-pretty">
              {description}
            </p>
          ) : null}
        </div>
        {trailing ? (
          <div className="shrink-0 self-center">{trailing}</div>
        ) : null}
      </div>
      <div
        className="mt-4 h-px w-full"
        style={{
          background:
            "linear-gradient(to right, transparent, var(--border-subtle) 8%, var(--border-subtle) 92%, transparent)",
        }}
      />
    </header>
  );
}

export default ScreenHeader;
