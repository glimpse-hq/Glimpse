import type {
  ButtonHTMLAttributes,
  CSSProperties,
  ReactNode,
} from "react";
import {
  ACTION_CARD_BUTTON_ACCENTS,
  type ActionCardAccent,
  type ActionCardAccentPreset,
} from "./actionCardButtonAccents";

type ActionCardButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  title: string;
  description?: string;
  icon?: ReactNode;
  accent?: Partial<ActionCardAccent>;
  accentPreset?: ActionCardAccentPreset;
  iconClassName?: string;
  titleClassName?: string;
  descriptionClassName?: string;
  contentClassName?: string;
  fullWidth?: boolean;
};

const joinClasses = (...classes: Array<string | false | null | undefined>) =>
  classes.filter(Boolean).join(" ");

const ActionCardButton = ({
  title,
  description,
  icon,
  accent,
  accentPreset,
  iconClassName,
  titleClassName,
  descriptionClassName,
  contentClassName,
  fullWidth = true,
  className,
  style,
  type = "button",
  ...props
}: ActionCardButtonProps) => {
  const presetAccent = accentPreset
    ? ACTION_CARD_BUTTON_ACCENTS[accentPreset]
    : ACTION_CARD_BUTTON_ACCENTS.interactive;
  const resolvedAccent = {
    ...presetAccent,
    ...accent,
  };
  const isCardLayout = fullWidth || Boolean(description);
  const actionStyle = {
    "--action-card-border": resolvedAccent.borderColor,
    "--action-card-background": resolvedAccent.backgroundColor,
    "--action-card-hover-shadow": fullWidth
      ? "var(--ui-action-card-hover-shadow)"
      : "var(--shadow-sm)",
    "--action-card-rest-shadow": fullWidth
      ? "var(--ui-action-card-rest-shadow)"
      : "none",
    ...style,
  } as CSSProperties;

  return (
    <button
      type={type}
      className={joinClasses(
        "group rounded-lg border border-border-primary bg-surface-surface text-left [box-shadow:var(--action-card-rest-shadow)] outline-hidden transition-[transform,box-shadow,border-color,background-color] duration-100 ease-out hover:border-[var(--action-card-border)] hover:bg-[var(--action-card-background)] hover:[box-shadow:var(--action-card-hover-shadow)] active:[box-shadow:none] focus-visible:ring-2 focus-visible:ring-border-hover disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:border-border-primary disabled:hover:bg-surface-surface disabled:hover:[box-shadow:var(--action-card-rest-shadow)]",
        isCardLayout
          ? joinClasses(
              "px-3 py-2.5",
              fullWidth ? "w-full active:translate-y-[2px]" : "inline-flex w-fit",
            )
          : "inline-flex w-auto px-2.5 py-1",
        className,
      )}
      style={actionStyle}
      {...props}
    >
      <div
        className={joinClasses(
          isCardLayout
            ? "flex items-center gap-2.5"
            : "flex w-full items-center gap-1.5",
          contentClassName,
        )}
      >
        {icon ? (
          <span
            aria-hidden="true"
            className={joinClasses(
              isCardLayout
                ? "flex size-5 shrink-0 items-center justify-center ui-color-primary"
                : "flex shrink-0 items-center justify-center text-[var(--color-text-muted)] transition-colors duration-150 group-hover:text-[var(--color-text-primary)]",
              iconClassName,
            )}
          >
            {icon}
          </span>
        ) : null}

        <div className="min-w-0">
          <span
            className={joinClasses(
              isCardLayout
                ? "ui-text-label-strong ui-color-primary block"
                : "ui-text-button ui-color-secondary block",
              titleClassName,
            )}
          >
            {title}
          </span>
          {description ? (
            <span
              className={joinClasses(
                "ui-text-micro ui-color-disabled block",
                descriptionClassName,
              )}
            >
              {description}
            </span>
          ) : null}
        </div>
      </div>
    </button>
  );
};

export default ActionCardButton;
