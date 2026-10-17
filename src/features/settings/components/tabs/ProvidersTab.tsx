import { useLingui } from "@lingui/react/macro";
import { motion, type Variants } from "framer-motion";
import SpeechModelPanel from "../SpeechModelPanel";
import SectionLabel from "../../../../shared/ui/SectionLabel";
import ProviderGuide, { CloudCardIllustration } from "../ProviderGuide";
import { getSpeechProviderPreset } from "../../../../shared/lib/speechProviders";
import type { RemoteSpeechProvider } from "../../../../types";

type ProvidersTabProps = {
  variants: Variants;
  remoteSpeechProvider: RemoteSpeechProvider;
  setRemoteSpeechProvider: (value: RemoteSpeechProvider) => void;
  remoteSpeechEndpoint: string;
  setRemoteSpeechEndpoint: (value: string) => void;
  remoteSpeechApiKey: string;
  setRemoteSpeechApiKey: (value: string) => void;
  remoteSpeechModel: string;
  setRemoteSpeechModel: (value: string) => void;
  availableSpeechModels: string[];
  fetchAvailableSpeechModels: () => void;
  onOpenModelsTab: () => void;
};

const ProvidersTab = ({
  variants,
  remoteSpeechProvider,
  setRemoteSpeechProvider,
  remoteSpeechEndpoint,
  setRemoteSpeechEndpoint,
  remoteSpeechApiKey,
  setRemoteSpeechApiKey,
  remoteSpeechModel,
  setRemoteSpeechModel,
  availableSpeechModels,
  fetchAvailableSpeechModels,
  onOpenModelsTab,
}: ProvidersTabProps) => {
  const { t } = useLingui();
  const speechPreset = getSpeechProviderPreset(remoteSpeechProvider);
  const speechProviderLabel =
    speechPreset && speechPreset.id !== "custom"
      ? speechPreset.label
      : t({ id: "settings.providers.guide.speech.provider", message: "Cloud" });

  return (
    <motion.div
      key="providers"
      variants={variants}
      initial="hidden"
      animate="visible"
      exit="exit"
      className="space-y-2"
    >
      <SectionLabel>
        {t({
          id: "settings.providers.speech_label",
          message: "Speech",
        })}
      </SectionLabel>
      <div className="grid grid-cols-2 items-start gap-x-4">
        <div className="grid">
          <SpeechModelPanel
            provider={remoteSpeechProvider}
            setProvider={setRemoteSpeechProvider}
            endpoint={remoteSpeechEndpoint}
            setEndpoint={setRemoteSpeechEndpoint}
            apiKey={remoteSpeechApiKey}
            setApiKey={setRemoteSpeechApiKey}
            model={remoteSpeechModel}
            setModel={setRemoteSpeechModel}
            availableModels={availableSpeechModels}
            fetchAvailableModels={fetchAvailableSpeechModels}
          />
        </div>
        <ProviderGuide
          body={t({
            id: "settings.providers.guide.speech.body",
            message:
              "To transcribe with this provider, switch it on in Models.",
          })}
          actionLabel={t({
            id: "settings.providers.guide.speech.action",
            message: "Open Models",
          })}
          onAction={onOpenModelsTab}
          illustration={
            <CloudCardIllustration providerLabel={speechProviderLabel} />
          }
        />
      </div>
    </motion.div>
  );
};

export default ProvidersTab;
