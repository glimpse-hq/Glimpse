import type { ReactNode } from "react";
import { useLingui } from "@lingui/react/macro";
import SectionLabel from "../../../shared/ui/SectionLabel";
import ToggleSwitch from "../../../shared/ui/ToggleSwitch";

type ModelSectionHeadingProps = {
  title: string;
  automatic: boolean;
  onAutomaticChange: (value: boolean) => void;
  // Replaces the switch's label, e.g. while Automatic downloads a model.
  automaticNote?: string | null;
};

// A section of the Models grid: its title, with Automatic as a mode of the
// whole section rather than a row among the models.
export const ModelSectionHeading = ({
  title,
  automatic,
  onAutomaticChange,
  automaticNote,
}: ModelSectionHeadingProps) => {
  const { t } = useLingui();
  const label = t({
    id: "settings.models.choose_automatically",
    message: "Choose automatically",
  });
  const control = (
    <label className="flex shrink-0 items-center gap-2">
      <span className="whitespace-nowrap ui-text-meta ui-color-muted">
        {automaticNote ?? label}
      </span>
      <ToggleSwitch
        enabled={automatic}
        onToggle={() => onAutomaticChange(!automatic)}
        ariaLabel={label}
      />
    </label>
  );

  return (
    <div className="col-span-3 mb-2 flex items-center gap-3">
      <SectionLabel className="flex-1">{title}</SectionLabel>
      {control}
    </div>
  );
};

// Quiet label above a section's models on this computer.
export const OnThisComputerHeading = ({
  trailing,
}: {
  trailing?: ReactNode;
}) => {
  const { t } = useLingui();
  return (
    <div className="col-span-3 mb-1 mt-4 flex items-center justify-between px-2.5">
      <span className="ui-text-meta ui-color-muted">
        {t({
          id: "settings.models.on_this_computer",
          message: "On this computer",
        })}
      </span>
      {trailing}
    </div>
  );
};
