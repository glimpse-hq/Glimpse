import type { ReactNode } from "react";

// A field's label row. It is always one height, so a field with an action
// beside its label (Microphone's Test) lines up with one without.
export function FieldLabel({
  children,
  trailing,
}: {
  children: ReactNode;
  trailing?: ReactNode;
}) {
  return (
    <div className="flex h-5 items-center justify-between gap-2">
      <div className="flex min-w-0 items-center gap-1 ui-text-label-strong ui-color-primary leading-none">
        {children}
      </div>
      {trailing}
    </div>
  );
}

export default FieldLabel;
