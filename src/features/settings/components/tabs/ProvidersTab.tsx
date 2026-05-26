import { useLingui } from "@lingui/react/macro";
import { motion, type Variants } from "framer-motion";
import LanguageModelPanel from "../LanguageModelPanel";
import type { LlmProvider } from "../../../../types";

type ProvidersTabProps = {
  variants: Variants;
  llmEnabled: boolean;
  setLlmEnabled: (value: boolean) => void;
  llmProvider: LlmProvider;
  setLlmProvider: (value: LlmProvider) => void;
  llmEndpoint: string;
  setLlmEndpoint: (value: string) => void;
  llmApiKey: string;
  setLlmApiKey: (value: string) => void;
  llmModel: string;
  setLlmModel: (value: string) => void;
  availableModels: string[];
  fetchAvailableModels: () => void;
};

const ProvidersTab = ({
  variants,
  llmEnabled,
  setLlmEnabled,
  llmProvider,
  setLlmProvider,
  llmEndpoint,
  setLlmEndpoint,
  llmApiKey,
  setLlmApiKey,
  llmModel,
  setLlmModel,
  availableModels,
  fetchAvailableModels,
}: ProvidersTabProps) => {
  const { t } = useLingui();

  return (
    <motion.div
      key="providers"
      variants={variants}
      initial="hidden"
      animate="visible"
      exit="exit"
      className="space-y-5"
    >
      <header>
        <h1 className="ui-text-title-lg font-medium ui-color-primary">
          {t({
            id: "settings.providers.title",
            message: "Providers",
          })}
        </h1>
        <p className="mt-1 ui-text-body-sm ui-color-muted">
          {t({
            id: "settings.providers.description",
            message:
              "Connect local-mode AI providers for Cleanup, Edit Mode, and Personalization.",
          })}
        </p>
      </header>

      <LanguageModelPanel
        llmEnabled={llmEnabled}
        setLlmEnabled={setLlmEnabled}
        llmProvider={llmProvider}
        setLlmProvider={setLlmProvider}
        llmEndpoint={llmEndpoint}
        setLlmEndpoint={setLlmEndpoint}
        llmApiKey={llmApiKey}
        setLlmApiKey={setLlmApiKey}
        llmModel={llmModel}
        setLlmModel={setLlmModel}
        availableModels={availableModels}
        fetchAvailableModels={fetchAvailableModels}
      />
    </motion.div>
  );
};

export default ProvidersTab;
