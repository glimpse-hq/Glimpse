import { useLingui } from "@lingui/react/macro";
import { ArrowUpRight, CircleNotch } from "@phosphor-icons/react";
import { useState } from "react";
import { openCheckout, type CheckoutSource, type PurchasePlan } from "../api";
import { FALLBACK_PLANS, formatPlanPrice } from "../purchaseConfig";
import { usePurchasePlans } from "../queries";

type PlanId = PurchasePlan["id"];

const PLAN_ORDER: PlanId[] = ["solo", "plus"];

type PlanPickerProps = {
  source: CheckoutSource;
  feature?: string;
};

// One tile per device count, each opening checkout for its plan.
// Plans come from the API, with fallbacks until they load.
const PlanPicker = ({ source, feature }: PlanPickerProps) => {
  const { t } = useLingui();
  const { data: plans } = usePurchasePlans();
  const [opening, setOpening] = useState<PlanId | null>(null);
  const [error, setError] = useState<string | null>(null);

  const plan = (id: PlanId) =>
    plans?.find((candidate) => candidate.id === id) ?? FALLBACK_PLANS[id];

  const planDevices = (id: PlanId) => {
    const devices = plan(id).devices;
    return devices === 1
      ? t({ id: "plans.devices.one", message: "1 Mac or PC" })
      : t({
          id: "plans.devices.many",
          message: `Up to ${devices} Macs or PCs`,
        });
  };

  const buy = async (tier: PlanId) => {
    setError(null);
    setOpening(tier);
    try {
      await openCheckout({ tier, source, feature });
    } catch (err) {
      setError(String(err));
    } finally {
      setOpening(null);
    }
  };

  return (
    <div className="w-full">
      <div className="grid grid-cols-2 gap-3">
        {PLAN_ORDER.map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => void buy(id)}
            disabled={opening !== null}
            className="group flex flex-col gap-0.5 rounded-xl bg-[var(--surface-interactive)] px-3.5 py-3 text-left transition-[background-color,transform] duration-150 ease-out hover:bg-[var(--surface-interactive-strong)] active:scale-[0.98] disabled:opacity-60"
          >
            <span className="ui-text-meta ui-color-secondary text-balance">
              {planDevices(id)}
            </span>
            <span className="mt-auto flex w-full items-center justify-between gap-2">
              <span className="flex items-baseline gap-1.5">
                <span className="ui-text-body-strong ui-color-primary tabular-nums">
                  {formatPlanPrice(plan(id))}
                </span>
                {plan(id).billing === "once" && (
                  <span className="ui-text-meta ui-color-muted">
                    {t({ id: "plans.one_time", message: "one-time" })}
                  </span>
                )}
              </span>
              {opening === id ? (
                <CircleNotch
                  size={14}
                  className="shrink-0 animate-spin ui-color-muted"
                  aria-hidden="true"
                />
              ) : (
                <ArrowUpRight
                  size={14}
                  aria-hidden="true"
                  className="shrink-0 ui-color-muted transition-[color,translate] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] group-enabled:group-hover:translate-x-0.5 group-enabled:group-hover:-translate-y-0.5 group-enabled:group-hover:text-content-primary"
                />
              )}
            </span>
          </button>
        ))}
      </div>

      <p
        aria-live="polite"
        className="mt-2 text-center ui-text-meta text-error empty:mt-0"
      >
        {error}
      </p>
    </div>
  );
};

export default PlanPicker;
