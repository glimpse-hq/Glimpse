import { useLingui } from "@lingui/react/macro";
import { ArrowUpRight, CircleNotch } from "@phosphor-icons/react";
import { useState } from "react";
import { openCheckout, type CheckoutSource, type PurchasePlan } from "../api";
import { usePurchasePlans } from "../queries";

type PlanId = PurchasePlan["id"];

const PLAN_ORDER: PlanId[] = ["plus", "solo"];

type PlanPickerProps = {
  source: CheckoutSource;
  feature?: string;
};

// Plus or Solo, then one button that opens checkout for the chosen plan.
// Prices come from the API; rows keep their height while they load.
const PlanPicker = ({ source, feature }: PlanPickerProps) => {
  const { t } = useLingui();
  const { data: plans } = usePurchasePlans();
  const [selected, setSelected] = useState<PlanId>("plus");
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const planName = (id: PlanId) =>
    id === "plus"
      ? t({ id: "plans.name.plus", message: "Glimpse Plus" })
      : t({ id: "plans.name.solo", message: "Glimpse Solo" });

  const planDetail = (id: PlanId) => {
    const devices = plans?.find((plan) => plan.id === id)?.devices;
    if (devices === undefined) return " ";
    return devices === 1
      ? t({ id: "plans.devices.one", message: "1 Mac or PC" })
      : t({
          id: "plans.devices.many",
          message: `Up to ${devices} Macs or PCs`,
        });
  };

  const planPrice = (id: PlanId) => {
    const plan = plans?.find((candidate) => candidate.id === id);
    if (!plan) return " ";
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: plan.currency,
      minimumFractionDigits: plan.priceCents % 100 === 0 ? 0 : 2,
    }).format(plan.priceCents / 100);
  };

  const allOnce = plans?.length
    ? plans.every((p) => p.billing === "once")
    : false;

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
              className="flex w-full items-center gap-3 py-2.5 text-left"
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
              <span className="min-w-0 flex-1">
                <span className="block ui-text-body-sm-strong ui-color-primary">
                  {planName(id)}
                </span>
                <span className="block truncate ui-text-meta ui-color-muted">
                  {planDetail(id)}
                </span>
              </span>
              <span className="shrink-0 ui-text-body-sm-strong ui-color-primary tabular-nums">
                {planPrice(id)}
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
        {selected === "plus"
          ? t({ id: "plans.buy.plus", message: "Get Glimpse Plus" })
          : t({ id: "plans.buy.solo", message: "Get Glimpse Solo" })}
        {opening ? (
          <CircleNotch size={13} className="animate-spin" aria-hidden="true" />
        ) : (
          <ArrowUpRight size={13} aria-hidden="true" />
        )}
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
