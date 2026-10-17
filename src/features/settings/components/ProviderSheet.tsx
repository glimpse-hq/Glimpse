import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useLingui } from "@lingui/react/macro";
import { motion } from "framer-motion";
import { Check } from "@phosphor-icons/react";
import { Dropdown } from "../../../shared/ui/Dropdown";
import ApiKeyField from "../../../shared/ui/ApiKeyField";
import { useFocusTrap } from "../../../shared/hooks/useFocusTrap";
import {
  applyModelDiscoveryFailure,
  applyModelDiscoverySuccess,
  beginModelDiscovery,
  EMPTY_MODEL_DISCOVERY_STATE,
} from "../modelDiscovery";

export type ProviderChoice = {
  id: string;
  label: string;
  server: boolean;
  endpoint: string;
  editableEndpoint: boolean;
  apiKeyRequired: boolean;
  defaultModel: string;
  canDiscoverModels: boolean;
};

export type ProviderDraft = {
  provider: string | null;
  endpoint: string;
  apiKey: string;
  model: string;
};

type ProviderSheetProps = {
  title: string;
  choices: ProviderChoice[];
  initial: ProviderDraft;
  // Speech offers a provider default ("auto"); language needs a model name.
  automaticModel: ((choice: ProviderChoice) => string) | null;
  isValid: (draft: ProviderDraft) => boolean;
  fetchModels: (endpoint: string, apiKey: string) => Promise<string[]>;
  onCancel: () => void;
  onDone: (draft: ProviderDraft) => void;
};

// The underline field style the other Settings cards use.
const FIELD_BUTTON_CLASS =
  "!rounded-none !border-0 !border-b !border-border-secondary !bg-transparent !px-0.5 !py-1 ui-text-body-sm hover:!border-content-primary focus:!border-content-primary";

const Field = ({ label, children }: { label: string; children: ReactNode }) => (
  <div>
    <span className="ui-text-label-strong ui-color-primary block">{label}</span>
    <div className="mt-1.5">{children}</div>
  </div>
);

// The trailing button on a provider row, like "Details..." in macOS Settings.
export const ProviderSheetButton = ({
  configured,
  onClick,
}: {
  configured: boolean;
  onClick: () => void;
}) => {
  const { t } = useLingui();
  return (
    <button
      type="button"
      onClick={onClick}
      className="ui-button-ghost h-6 px-2 ui-text-meta font-medium"
    >
      {configured
        ? t({ id: "settings.models.provider.edit", message: "Edit…" })
        : t({ id: "settings.models.provider.set_up.v2", message: "Set Up…" })}
    </button>
  );
};

const ProviderSheet = ({
  title,
  choices,
  initial,
  automaticModel,
  isValid,
  fetchModels,
  onCancel,
  onDone,
}: ProviderSheetProps) => {
  const { t } = useLingui();
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, true, onCancel);
  const [draft, setDraft] = useState<ProviderDraft>(initial);
  const [discovery, setDiscovery] = useState(EMPTY_MODEL_DISCOVERY_STATE);
  const discoveryRef = useRef(EMPTY_MODEL_DISCOVERY_STATE);
  const [modelStatus, setModelStatus] = useState<
    "idle" | "loading" | "empty" | "failed"
  >("idle");
  const selectedRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Starts on the provider that is set up: the focus trap has focused the
  // first control by now, and the list is long.
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const list = listRef.current;
      const selected = selectedRef.current;
      if (!list || !selected) return;
      list.scrollTop = selected.offsetTop - list.clientHeight / 2;
      selected.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, []);
  const choice = choices.find((item) => item.id === draft.provider) ?? null;
  const groups = [
    {
      label: t({ id: "settings.models.group.server", message: "Local server" }),
      items: choices.filter((item) => item.server),
    },
    {
      label: t({ id: "settings.models.location.cloud", message: "Cloud" }),
      items: choices.filter((item) => !item.server),
    },
  ];

  const updateDiscovery = (next: typeof discovery) => {
    discoveryRef.current = next;
    setDiscovery(next);
  };

  const pick = (next: ProviderChoice) => {
    if (next.id === draft.provider) return;
    updateDiscovery({
      requestSeq: discoveryRef.current.requestSeq + 1,
      models: [],
    });
    setModelStatus("idle");
    setDraft((current) => ({
      ...current,
      provider: next.id,
      endpoint: next.endpoint,
      model: automaticModel ? "auto" : next.defaultModel,
    }));
  };

  const discover = async () => {
    if (!choice?.canDiscoverModels) return;
    const begun = beginModelDiscovery(discoveryRef.current);
    updateDiscovery(begun.state);
    setModelStatus("loading");
    const current = () => discoveryRef.current.requestSeq === begun.requestSeq;
    try {
      const models = await fetchModels(draft.endpoint, draft.apiKey);
      updateDiscovery(
        applyModelDiscoverySuccess(
          discoveryRef.current,
          begun.requestSeq,
          models,
        ),
      );
      if (current()) setModelStatus(models.length > 0 ? "idle" : "empty");
    } catch {
      updateDiscovery(
        applyModelDiscoveryFailure(discoveryRef.current, begun.requestSeq),
      );
      if (current()) setModelStatus("failed");
    }
  };

  const models = Array.from(
    new Set(discovery.models.map((model) => model.trim()).filter(Boolean)),
  );
  const modelOptions = [
    ...(automaticModel && choice
      ? [{ value: "auto", label: automaticModel(choice) }]
      : []),
    ...models.map((model) => ({ value: model, label: model })),
    ...(draft.model && draft.model !== "auto" && !models.includes(draft.model)
      ? [{ value: draft.model, label: draft.model }]
      : []),
  ];
  const valid = isValid(draft);

  return createPortal(
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="settings-typescale font-sans fixed inset-0 z-[100] flex items-center justify-center bg-black/70 px-6 backdrop-blur-xs"
      onClick={onCancel}
    >
      <motion.div
        ref={dialogRef}
        initial={{ scale: 0.96, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.96, opacity: 0 }}
        transition={{ duration: 0.18 }}
        className="w-full max-w-xl rounded-2xl border border-border-primary bg-surface-tertiary p-5 ui-shadow-modal-deep"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="provider-sheet-title"
      >
        <p
          id="provider-sheet-title"
          className="ui-text-body-lg font-semibold text-content-primary"
        >
          {title}
        </p>

        <div className="mt-4 grid grid-cols-[13rem_minmax(0,1fr)] gap-5">
          <div
            ref={listRef}
            role="radiogroup"
            aria-labelledby="provider-sheet-title"
            className="custom-scrollbar relative -ml-2.5 h-[17rem] overflow-y-auto pr-1"
          >
            {groups.map((group) =>
              group.items.length === 0 ? null : (
                <div key={group.label} className="mb-2">
                  <span className="block px-2.5 pb-1 ui-text-meta ui-color-muted">
                    {group.label}
                  </span>
                  {group.items.map((item) => {
                    const selected = item.id === draft.provider;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        ref={selected ? selectedRef : undefined}
                        role="radio"
                        aria-checked={selected}
                        onClick={() => pick(item)}
                        className={`flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left transition-colors focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)] ${
                          selected
                            ? "bg-surface-elevated/60"
                            : "hover:bg-surface-elevated/40"
                        }`}
                      >
                        <span className="truncate ui-text-body-sm text-content-primary">
                          {item.label}
                        </span>
                        {selected && (
                          <Check
                            size={12}
                            className="shrink-0 ui-color-cloud"
                            aria-hidden="true"
                          />
                        )}
                      </button>
                    );
                  })}
                </div>
              ),
            )}
          </div>

          <div
            className={`space-y-4 ${choice ? "" : "pointer-events-none opacity-40"}`}
            inert={!choice}
          >
            <Field
              label={t({
                id: "settings.models.provider.endpoint",
                message: "Endpoint",
              })}
            >
              <input
                value={draft.endpoint}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    endpoint: event.target.value,
                  }))
                }
                readOnly={!choice?.editableEndpoint}
                placeholder={t({
                  id: "settings.language_model.endpoint.placeholder.v2",
                  message: "https://api.example.com/v1",
                })}
                aria-label={t({
                  id: "settings.models.provider.endpoint",
                  message: "Endpoint",
                })}
                spellCheck={false}
                className={`w-full border-b border-border-secondary bg-transparent px-0.5 py-1 ui-text-body-sm placeholder-content-disabled transition-colors focus:outline-none focus:border-content-primary ${
                  choice?.editableEndpoint
                    ? "ui-color-primary"
                    : "ui-color-muted"
                }`}
              />
            </Field>
            <Field
              label={t({
                id: "settings.language_model.api_key.v2",
                message: "API key",
              })}
            >
              <ApiKeyField
                value={draft.apiKey}
                onChange={(value) =>
                  setDraft((current) => ({ ...current, apiKey: value }))
                }
                placeholder={
                  choice?.apiKeyRequired
                    ? t({
                        id: "settings.language_model.api_key.required",
                        message: "Required",
                      })
                    : t({
                        id: "settings.language_model.api_key.optional",
                        message: "Optional",
                      })
                }
                ariaLabel={t({
                  id: "settings.language_model.api_key.v2",
                  message: "API key",
                })}
              />
            </Field>
            <Field
              label={t({
                id: "settings.language_model.model",
                message: "Model",
              })}
            >
              <Dropdown
                value={draft.model || null}
                ariaLabel={t({
                  id: "settings.language_model.model",
                  message: "Model",
                })}
                onChange={(value) =>
                  setDraft((current) => ({ ...current, model: value }))
                }
                onOpen={() => void discover()}
                options={modelOptions}
                placeholder={t({
                  id: "settings.general.cleanup.model_placeholder",
                  message: "Choose a model",
                })}
                searchable
                searchPlaceholder={t({
                  id: "settings.language_model.model.search",
                  message: "Search available models...",
                })}
                buttonClassName={FIELD_BUTTON_CLASS}
              />
              <p
                className={`mt-1 h-4 truncate ui-text-meta ${
                  modelStatus === "failed"
                    ? "ui-color-warning"
                    : "ui-color-muted"
                }`}
                aria-live="polite"
              >
                {modelStatus === "loading"
                  ? t({
                      id: "settings.models.provider.models_loading",
                      message: "Loading models…",
                    })
                  : modelStatus === "empty"
                    ? t({
                        id: "settings.models.provider.models_empty",
                        message: "This provider didn't list any models.",
                      })
                    : modelStatus === "failed"
                      ? t({
                          id: "settings.models.provider.models_failed",
                          message: "Couldn't load models from this provider.",
                        })
                      : null}
              </p>
            </Field>
          </div>
        </div>

        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg px-3 py-2 ui-text-body-sm font-medium text-content-muted transition-colors hover:text-content-primary"
          >
            {t({ id: "settings.app.cancel", message: "Cancel" })}
          </button>
          <button
            type="button"
            onClick={() => onDone(draft)}
            disabled={!valid}
            className="ui-button-primary rounded-lg px-4 py-2 ui-text-body-sm"
          >
            {t({ id: "settings.models.provider.done", message: "Done" })}
          </button>
        </div>
      </motion.div>
    </motion.div>,
    document.body,
  );
};

export default ProviderSheet;
