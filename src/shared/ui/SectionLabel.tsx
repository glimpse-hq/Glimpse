import type { ReactNode } from "react";

interface SectionLabelProps {
  icon?: ReactNode;
  children: ReactNode;
  trailing?: ReactNode;
  className?: string;
}

export function SectionLabel({
  icon,
  children,
  trailing,
  className = "",
}: SectionLabelProps) {
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      {icon ? (
        <span className="flex shrink-0 items-center ui-color-muted">{icon}</span>
      ) : null}
      <h2 className="shrink-0 ui-text-body-lg-strong ui-color-secondary">
        {children}
      </h2>
      {trailing ? <span className="flex shrink-0 items-center">{trailing}</span> : null}
      <div className="ui-divider-trailing flex-1" />
    </div>
  );
}

export default SectionLabel;
