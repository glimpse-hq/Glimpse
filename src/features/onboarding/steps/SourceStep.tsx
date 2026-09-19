import { useLingui } from "@lingui/react/macro";
import { Check } from "@phosphor-icons/react";
import {
  OnboardingHeader,
  OnboardingStep,
  type StepMotionProps,
} from "./shared";

export type OnboardingSource =
  | "search"
  | "ai"
  | "friend"
  | "reddit"
  | "youtube"
  | "x"
  | "product_hunt"
  | "microsoft_store"
  | "other";

interface SourceStepProps {
  stepMotionProps: StepMotionProps;
  isWindows: boolean;
  selected: OnboardingSource | null;
  onSelect: (source: OnboardingSource) => void;
  onSkip: () => void;
}

export function SourceStep({
  stepMotionProps,
  isWindows,
  selected,
  onSelect,
  onSkip,
}: SourceStepProps) {
  const { t } = useLingui();

  const options: { id: OnboardingSource; label: string }[] = [
    {
      id: "search",
      label: t({ id: "onboarding.source.search", message: "Search engine" }),
    },
    {
      id: "ai",
      label: t({ id: "onboarding.source.ai", message: "AI assistant" }),
    },
    {
      id: "friend",
      label: t({ id: "onboarding.source.friend", message: "Friend or coworker" }),
    },
    { id: "reddit", label: "Reddit" },
    { id: "youtube", label: "YouTube" },
    { id: "x", label: "X" },
    { id: "product_hunt", label: "Product Hunt" },
    ...(isWindows
      ? [{ id: "microsoft_store" as const, label: "Microsoft Store" }]
      : []),
    {
      id: "other",
      label: t({ id: "onboarding.source.other", message: "Somewhere else" }),
    },
  ];

  return (
    <OnboardingStep
      stepKey="source"
      motionProps={stepMotionProps}
      align="center"
      footer={
        <div className="flex h-5 items-center justify-center">
          <button
            type="button"
            onClick={onSkip}
            className="ui-text-body-sm text-content-muted transition-colors hover:text-content-primary"
          >
            {t({ id: "onboarding.source.skip", message: "Skip" })}
          </button>
        </div>
      }
    >
      <OnboardingHeader
        title={t({
          id: "onboarding.source.title",
          message: "How did you find Glimpse?",
        })}
      />

      <div className="grid w-full grid-cols-2 gap-2">
        {options.map((option) => {
          const isSelected = selected === option.id;
          return (
            <button
              key={option.id}
              type="button"
              onClick={() => onSelect(option.id)}
              aria-pressed={isSelected}
              className={`group flex h-11 w-full items-center gap-3 rounded-xl border px-3.5 text-left transition-[background-color,border-color,transform] duration-150 active:scale-[0.99] ${
                isSelected
                  ? "border-cloud bg-cloud-10"
                  : "border-border-primary hover:border-cloud-50 hover:bg-[var(--surface-interactive)] active:bg-[var(--surface-interactive-pressed)]"
              }`}
            >
              <span
                className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border transition-colors duration-150 ${
                  isSelected
                    ? "border-cloud bg-cloud"
                    : "border-border-secondary group-hover:border-cloud-50"
                }`}
              >
                {isSelected ? (
                  <Check
                    size={10}
                    weight="bold"
                    className="text-surface-secondary"
                  />
                ) : null}
              </span>
              <span className="min-w-0 flex-1 truncate ui-text-body-sm-strong text-content-primary">
                {option.label}
              </span>
            </button>
          );
        })}
      </div>
    </OnboardingStep>
  );
}
