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

// One row per device count, then one button that opens checkout for the
// chosen plan. Plans come from the API, with fallbacks until they load.
const PlanPicker = ({ source, feature }: PlanPickerProps) => {
  const { t } = useLingui();
  const { data: plans } = usePurchasePlans();
  const [selected, setSelected] = useState<PlanId>("solo");
  const [opening, setOpening] = useState(false);
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

  const selectedPrice = formatPlanPrice(plan(selected));

  const allOnce = (plans?.length ? plans : Object.values(FALLBACK_PLANS)).every(
    (p) => p.billing === "once",
  );

  const buy = async () => {
    setError(null);
    setOpening(true);
    try {
      await openCheckout({ tier: selected, source, feature });
    } catch (err) {
      setError(String(err));
    } finally {
      setOpening(false);
    }
  };

  return (
    <div className="w-full">
      <div
        role="radiogroup"
        aria-label={t({ id: "plans.picker_aria", message: "Plan" })}
        className="divide-y divide-border-primary border-y border-border-primary"
      >
        {PLAN_ORDER.map((id) => {
          const checked = selected === id;
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={checked}
              onClick={() => setSelected(id)}
              className="flex w-full items-center gap-3 py-3 text-left"
            >
              <span
                aria-hidden="true"
                className={`flex size-4 shrink-0 items-center justify-center rounded-full border transition-colors ${
                  checked ? "border-cloud" : "border-border-secondary"
                }`}
              >
                <span
                  className={`size-2 rounded-full bg-cloud transition-opacity ${
                    checked ? "opacity-100" : "opacity-0"
                  }`}
                />
              </span>
              <span className="min-w-0 flex-1 truncate ui-text-body-sm-strong ui-color-primary">
                {planDevices(id)}
              </span>
              <span className="shrink-0 ui-text-body-sm-strong ui-color-primary tabular-nums">
                {formatPlanPrice(plan(id))}
              </span>
            </button>
          );
        })}
      </div>

      <button
        type="button"
        onClick={() => void buy()}
        disabled={opening}
        className="ui-button-primary mt-4 flex h-9 w-full items-center justify-center gap-2 rounded-lg ui-text-body-sm"
      >
        {t({ id: "plans.buy.v4", message: "Unlock" })}
        <span className="flex items-center gap-2 ui-text-meta tabular-nums opacity-70">
          {selectedPrice}
          {opening ? (
            <CircleNotch
              size={13}
              className="animate-spin"
              aria-hidden="true"
            />
          ) : (
            <ArrowUpRight size={13} aria-hidden="true" />
          )}
        </span>
      </button>

      <p
        aria-live="polite"
        className={`mt-2 min-h-5 text-center ui-text-meta ${error ? "text-error" : "ui-color-muted"}`}
      >
        {error ??
          (allOnce
            ? t({
                id: "plans.once_note",
                message: "One payment. Dictation stays free either way.",
              })
            : " ")}
      </p>
    </div>
  );
};

export default PlanPicker;
