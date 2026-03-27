import type {
  ButtonHTMLAttributes,
  CSSProperties,
  ReactNode,
} from "react";

export type ActionCardAccent = {
  borderColor: string;
  backgroundColor: string;
  shadowColor: string;
  insetColor: string;
};

export const ACTION_CARD_BUTTON_ACCENTS = {
  amber: {
    borderColor: "var(--color-cloud-30)",
    backgroundColor: "var(--color-cloud-10)",
    shadowColor: "rgba(251, 191, 36, 0.4)",
    insetColor: "rgba(251, 191, 36, 0.1)",
  },
  cloud: {
    borderColor: "var(--color-cloud-30)",
    backgroundColor: "var(--color-cloud-10)",
    shadowColor: "rgba(251, 191, 36, 0.4)",
    insetColor: "rgba(251, 191, 36, 0.1)",
  },
  local: {
    borderColor: "var(--color-local-30)",
    backgroundColor: "var(--color-local-10)",
    shadowColor: "rgba(165, 179, 254, 0.4)",
    insetColor: "rgba(165, 179, 254, 0.1)",
  },
  accent: {
    borderColor: "var(--color-accent-30)",
    backgroundColor: "var(--color-accent-10)",
    shadowColor: "rgba(143, 111, 247, 0.4)",
    insetColor: "rgba(143, 111, 247, 0.1)",
  },
  error: {
    borderColor: "rgba(239, 68, 68, 0.3)",
    backgroundColor: "rgba(239, 68, 68, 0.08)",
    shadowColor: "rgba(239, 68, 68, 0.4)",
    insetColor: "rgba(239, 68, 68, 0.1)",
  },
} satisfies Record<string, ActionCardAccent>;

type ActionCardButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  title: string;
  description?: string;
  icon?: ReactNode;
  accent?: Partial<ActionCardAccent>;
  iconClassName?: string;
  titleClassName?: string;
  descriptionClassName?: string;
  contentClassName?: string;
};

const BASE_SHADOW =
  "0 3px 0 -1px rgba(0, 0, 0, 0.5)";

const joinClasses = (...classes: Array<string | false | null | undefined>) =>
  classes.filter(Boolean).join(" ");

const ActionCardButton = ({
  title,
  description,
  icon,
  accent,
  iconClassName,
  titleClassName,
  descriptionClassName,
  contentClassName,
  className,
  style,
  type = "button",
  ...props
}: ActionCardButtonProps) => {
  const resolvedAccent = {
    ...ACTION_CARD_BUTTON_ACCENTS.amber,
    ...accent,
  };
  const actionStyle = {
    "--action-card-border": resolvedAccent.borderColor,
    "--action-card-background": resolvedAccent.backgroundColor,
    "--action-card-shadow": `0 2px 0 -1px ${resolvedAccent.shadowColor}`,
    "--action-card-rest-shadow": BASE_SHADOW,
    ...style,
  } as CSSProperties;

  return (
    <button
      type={type}
      className={joinClasses(
        "group w-full rounded-lg border border-border-primary bg-surface-surface px-3 py-2.5 text-left [box-shadow:var(--action-card-rest-shadow)] outline-hidden transition-[transform,box-shadow,border-color,background-color] duration-100 ease-out hover:border-[var(--action-card-border)] hover:bg-[var(--action-card-background)] hover:[box-shadow:var(--action-card-shadow)] hover:-translate-y-[1px] active:translate-y-[2px] active:[box-shadow:none] focus-visible:ring-2 focus-visible:ring-border-hover disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:border-border-primary disabled:hover:bg-surface-surface disabled:hover:[box-shadow:var(--action-card-rest-shadow)]",
        className,
      )}
      style={actionStyle}
      {...props}
    >
      <div className={joinClasses("flex items-start gap-3", contentClassName)}>
        {icon ? (
          <span
            aria-hidden="true"
            className={joinClasses(
              "mt-0.5 flex size-5 shrink-0 items-center justify-center ui-color-primary",
              iconClassName,
            )}
          >
            {icon}
          </span>
        ) : null}

        <div className="min-w-0">
          <span
            className={joinClasses(
              "ui-text-label-strong ui-color-primary block",
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
