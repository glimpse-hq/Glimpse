import type { RemoteSpeechProvider, StoredSettings } from "../../types";

export type { RemoteSpeechProvider };

export type SpeechProviderCompatibility =
  | "native"
  | "direct-openai-compatible"
  | "openai-compatible-proxy"
  | "openai-compatible-self-hosted";

export type SpeechProviderPreset = {
  id: RemoteSpeechProvider;
  label: string;
  endpoint: string;
  defaultModel: string;
  apiKeyRequired: boolean;
  compatibility: SpeechProviderCompatibility;
  supportsModelDiscovery: boolean;
  notes?: string;
};

const SPEECH_PROVIDER_PRESETS: SpeechProviderPreset[] = [
  {
    id: "custom",
    label: "Custom",
    endpoint: "",
    defaultModel: "auto",
    apiKeyRequired: false,
    compatibility: "direct-openai-compatible",
    supportsModelDiscovery: true,
  },
  {
    id: "openai",
    label: "OpenAI",
    endpoint: "https://api.openai.com/v1",
    defaultModel: "gpt-transcribe",
    apiKeyRequired: true,
    compatibility: "direct-openai-compatible",
    supportsModelDiscovery: true,
  },
  {
    id: "groq",
    label: "Groq",
    endpoint: "https://api.groq.com/openai/v1",
    defaultModel: "whisper-large-v3-turbo",
    apiKeyRequired: true,
    compatibility: "direct-openai-compatible",
    supportsModelDiscovery: true,
  },
  {
    id: "xai",
    label: "xAI (Grok)",
    endpoint: "https://api.x.ai/v1",
    defaultModel: "grok-voice-transcribe-2.0",
    apiKeyRequired: true,
    compatibility: "direct-openai-compatible",
    supportsModelDiscovery: false,
  },
  {
    id: "mistral",
    label: "Mistral",
    endpoint: "https://api.mistral.ai/v1",
    defaultModel: "voxtral-mini-latest",
    apiKeyRequired: true,
    compatibility: "direct-openai-compatible",
    supportsModelDiscovery: true,
  },
  {
    id: "fireworks",
    label: "Fireworks AI",
    endpoint: "https://audio-turbo.api.fireworks.ai/v1",
    defaultModel: "whisper-v3-turbo",
    apiKeyRequired: true,
    compatibility: "direct-openai-compatible",
    supportsModelDiscovery: true,
    notes: "Uses the Fireworks audio API base, not the normal inference base.",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    endpoint: "https://openrouter.ai/api/v1",
    defaultModel: "openai/gpt-transcribe",
    apiKeyRequired: true,
    compatibility: "direct-openai-compatible",
    supportsModelDiscovery: true,
  },
  {
    id: "deepgram",
    label: "Deepgram",
    endpoint: "https://api.deepgram.com/v1",
    defaultModel: "nova-3",
    apiKeyRequired: true,
    compatibility: "native",
    supportsModelDiscovery: true,
  },
  {
    id: "elevenlabs",
    label: "ElevenLabs",
    endpoint: "https://api.elevenlabs.io/v1",
    defaultModel: "scribe_v2",
    apiKeyRequired: true,
    compatibility: "native",
    supportsModelDiscovery: false,
  },
  {
    id: "vllm",
    label: "vLLM",
    endpoint: "http://localhost:8000/v1",
    defaultModel: "openai/whisper-large-v3-turbo",
    apiKeyRequired: false,
    compatibility: "openai-compatible-self-hosted",
    supportsModelDiscovery: true,
  },
  {
    id: "localai",
    label: "LocalAI",
    endpoint: "http://localhost:8080/v1",
    defaultModel: "whisper-1",
    apiKeyRequired: false,
    compatibility: "openai-compatible-self-hosted",
    supportsModelDiscovery: true,
  },
  {
    id: "whisper-cpp",
    label: "whisper.cpp",
    endpoint: "http://127.0.0.1:8080/v1",
    defaultModel: "whisper-1",
    apiKeyRequired: false,
    compatibility: "openai-compatible-self-hosted",
    supportsModelDiscovery: false,
  },
  {
    id: "llamaedge",
    label: "LlamaEdge Whisper",
    endpoint: "http://localhost:8080/v1",
    defaultModel: "whisper-1",
    apiKeyRequired: false,
    compatibility: "openai-compatible-self-hosted",
    supportsModelDiscovery: false,
  },
  {
    id: "litellm",
    label: "LiteLLM Proxy",
    endpoint: "http://localhost:4000/v1",
    defaultModel: "whisper-1",
    apiKeyRequired: false,
    compatibility: "openai-compatible-proxy",
    supportsModelDiscovery: true,
  },
];

export const SPEECH_PROVIDERS = SPEECH_PROVIDER_PRESETS.filter(
  (provider) => provider.id !== "custom",
);

export const LOCAL_SPEECH_PROVIDERS = SPEECH_PROVIDERS.filter(
  (p) => !p.apiKeyRequired,
);
export const CLOUD_SPEECH_PROVIDERS = SPEECH_PROVIDERS.filter(
  (p) => p.apiKeyRequired,
);

export function getSpeechProviderPreset(
  id: RemoteSpeechProvider,
): SpeechProviderPreset | undefined {
  return SPEECH_PROVIDER_PRESETS.find((provider) => provider.id === id);
}

export function supportsSpeechProviderModelDiscovery(
  id: RemoteSpeechProvider,
): boolean {
  return getSpeechProviderPreset(id)?.supportsModelDiscovery ?? false;
}

export function resolvedSpeechEndpoint(
  provider: RemoteSpeechProvider,
  endpoint: string,
): string {
  const trimmed = endpoint.trim();
  if (trimmed) {
    return trimmed;
  }
  return getSpeechProviderPreset(provider)?.endpoint ?? "";
}

export function resolvedSpeechModel(
  provider: RemoteSpeechProvider,
  model: string,
): string | undefined {
  const trimmed = model.trim();
  if (!trimmed || trimmed.toLowerCase() === "auto") {
    const defaultModel = getSpeechProviderPreset(provider)?.defaultModel;
    if (!defaultModel || defaultModel.toLowerCase() === "auto") {
      return undefined;
    }
    return defaultModel;
  }
  return trimmed;
}

export function isRemoteSpeechConfigured(args: {
  enabled: boolean;
  provider: RemoteSpeechProvider;
  endpoint: string;
  model: string;
  apiKey: string;
}): boolean {
  if (!args.enabled) {
    return false;
  }
  const preset = getSpeechProviderPreset(args.provider);
  return (
    resolvedSpeechEndpoint(args.provider, args.endpoint).length > 0 &&
    resolvedSpeechModel(args.provider, args.model) !== undefined &&
    (!preset?.apiKeyRequired || args.apiKey.trim() !== "")
  );
}

const REMOTE_SPEECH_MODEL_PREFIX = "remote:";

function formatSpeechProviderModelLabel(
  providerId: string,
  model: string,
): string {
  const label =
    getSpeechProviderPreset(providerId as RemoteSpeechProvider)?.label ??
    providerId;
  const trimmedModel = model.trim();
  return trimmedModel ? `${label} · ${trimmedModel}` : label;
}

function inferSpeechProviderFromModel(
  model: string,
): SpeechProviderPreset | undefined {
  const normalized = model.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }
  return SPEECH_PROVIDER_PRESETS.find(
    (preset) => preset.defaultModel.trim().toLowerCase() === normalized,
  );
}

export function formatTranscriptionSpeechModel(stored: string): string | null {
  const trimmed = stored.trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed.startsWith(REMOTE_SPEECH_MODEL_PREFIX)) {
    const payload = trimmed.slice(REMOTE_SPEECH_MODEL_PREFIX.length);
    const splitAt = payload.indexOf(":");
    if (splitAt > 0) {
      return formatSpeechProviderModelLabel(
        payload.slice(0, splitAt),
        payload.slice(splitAt + 1),
      );
    }
    const preset = getSpeechProviderPreset(payload as RemoteSpeechProvider);
    const fallbackModel =
      preset?.defaultModel && preset.defaultModel !== "auto"
        ? preset.defaultModel
        : "";
    return formatSpeechProviderModelLabel(payload, fallbackModel);
  }

  const legacyRemote = trimmed.match(/^remote\s*\((.+)\)\s*$/i);
  if (legacyRemote) {
    const model = legacyRemote[1].trim();
    const preset = inferSpeechProviderFromModel(model);
    if (preset) {
      return formatSpeechProviderModelLabel(preset.id, model);
    }
    return model;
  }

  return trimmed;
}

export function isRemoteTranscriptionSpeechModel(stored: string): boolean {
  const trimmed = stored.trim();
  return (
    trimmed.startsWith(REMOTE_SPEECH_MODEL_PREFIX) ||
    /^remote\s*\(/i.test(trimmed)
  );
}

export function isRemoteSpeechInUse(
  settings: Pick<
    StoredSettings,
    | "remote_speech_enabled"
    | "remote_speech_provider"
    | "remote_speech_endpoint"
    | "remote_speech_model"
    | "remote_speech_api_key"
  >,
): boolean {
  return isRemoteSpeechConfigured({
    enabled: settings.remote_speech_enabled,
    provider: settings.remote_speech_provider,
    endpoint: settings.remote_speech_endpoint,
    model: settings.remote_speech_model,
    apiKey: settings.remote_speech_api_key,
  });
}
