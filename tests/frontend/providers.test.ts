import { describe, expect, test } from "bun:test";
import {
  CLOUD_PROVIDERS,
  LOCAL_PROVIDERS,
  formatTranscriptionLlmModel,
  isCloudLlmInUse,
  isLlmInUse,
  resolvedLlmEndpoint,
} from "../../src/shared/lib/llmProviders";
import {
  SPEECH_PROVIDERS,
  formatTranscriptionSpeechModel,
  isRemoteSpeechConfigured,
  isRemoteTranscriptionSpeechModel,
  resolvedSpeechModel,
  supportsSpeechProviderModelDiscovery,
} from "../../src/shared/lib/speechProviders";

type LlmSettings = Parameters<typeof isLlmInUse>[0];

const llm = (overrides: Partial<LlmSettings>): LlmSettings => ({
  llm_enabled: true,
  llm_provider: "openai",
  llm_endpoint: "",
  llm_api_key: "sk-test",
  llm_model: "gpt-test",
  ...overrides,
});

describe("LLM providers", () => {
  test("local presets need no key and cloud presets do", () => {
    expect(LOCAL_PROVIDERS.map((p) => p.id)).toEqual(
      expect.arrayContaining(["custom", "apple", "lmstudio", "ollama"]),
    );
    expect(CLOUD_PROVIDERS.every((p) => p.apiKeyRequired)).toBe(true);
    expect(CLOUD_PROVIDERS.some((p) => p.id === "ollama")).toBe(false);
  });

  test("a blank endpoint falls back to the preset", () => {
    expect(resolvedLlmEndpoint("ollama", "  ")).toBe(
      "http://localhost:11434/v1",
    );
    expect(resolvedLlmEndpoint("ollama", " http://box:1/v1 ")).toBe(
      "http://box:1/v1",
    );
    expect(resolvedLlmEndpoint("custom", "")).toBe("");
  });

  test("is in use only when enabled and fully configured", () => {
    expect(isLlmInUse(llm({}))).toBe(true);
    expect(isLlmInUse(llm({ llm_enabled: false }))).toBe(false);
    expect(isLlmInUse(llm({ llm_api_key: "   " }))).toBe(false);
    expect(isLlmInUse(llm({ llm_model: " " }))).toBe(false);
    expect(isLlmInUse(llm({ llm_provider: "ollama", llm_api_key: "" }))).toBe(
      true,
    );
    expect(isLlmInUse(llm({ llm_provider: "custom", llm_api_key: "" }))).toBe(
      false,
    );
    expect(
      isLlmInUse(
        llm({ llm_provider: "apple", llm_model: "", llm_api_key: "" }),
      ),
    ).toBe(true);
  });

  test("local hosts and the on-device model are not cloud", () => {
    expect(isCloudLlmInUse(llm({}))).toBe(true);
    expect(isCloudLlmInUse(llm({ llm_provider: "ollama" }))).toBe(false);
    expect(isCloudLlmInUse(llm({ llm_provider: "apple" }))).toBe(false);
    for (const endpoint of [
      "http://127.0.0.1:8080/v1",
      "LOCALHOST:1234",
      "http://[::1]:11434",
      "http://0.0.0.0/v1",
    ]) {
      expect(
        isCloudLlmInUse(
          llm({ llm_provider: "custom", llm_endpoint: endpoint }),
        ),
      ).toBe(false);
    }
    for (const endpoint of [
      "http://localhost.example.com/v1",
      "http://127.0.0.1.nip.io/v1",
      "https://my-localhost/v1",
    ]) {
      expect(
        isCloudLlmInUse(
          llm({ llm_provider: "custom", llm_endpoint: endpoint }),
        ),
      ).toBe(true);
    }
  });

  test("formats stored model labels", () => {
    expect(formatTranscriptionLlmModel("  ")).toBeNull();
    expect(formatTranscriptionLlmModel("openai:gpt-4o")).toBe(
      "OpenAI · gpt-4o",
    );
    expect(formatTranscriptionLlmModel("anthropic: ")).toBe("Anthropic");
    expect(formatTranscriptionLlmModel("apple")).toBe("Apple Intelligence");
    expect(formatTranscriptionLlmModel("acme:big")).toBe("acme · big");
    expect(formatTranscriptionLlmModel("some-model")).toBe("some-model");
  });
});

describe("speech providers", () => {
  test("custom is a preset but not listed", () => {
    expect(SPEECH_PROVIDERS.some((p) => p.id === "custom")).toBe(false);
    expect(supportsSpeechProviderModelDiscovery("custom")).toBe(true);
    expect(supportsSpeechProviderModelDiscovery("whisper-cpp")).toBe(false);
  });

  test("auto and blank models resolve to the preset default", () => {
    expect(resolvedSpeechModel("openai", "")).toBe("gpt-transcribe");
    expect(resolvedSpeechModel("groq", "AUTO")).toBe("whisper-large-v3-turbo");
    expect(resolvedSpeechModel("custom", "auto")).toBeUndefined();
    expect(resolvedSpeechModel("custom", " my-model ")).toBe("my-model");
  });

  test("remote speech needs an endpoint, a model, and a key where required", () => {
    const base = {
      enabled: true,
      provider: "openai" as const,
      endpoint: "",
      model: "",
      apiKey: "sk",
    };
    expect(isRemoteSpeechConfigured(base)).toBe(true);
    expect(isRemoteSpeechConfigured({ ...base, enabled: false })).toBe(false);
    expect(isRemoteSpeechConfigured({ ...base, apiKey: " " })).toBe(false);
    expect(
      isRemoteSpeechConfigured({ ...base, provider: "custom", apiKey: "" }),
    ).toBe(false);
    expect(
      isRemoteSpeechConfigured({
        ...base,
        provider: "custom",
        endpoint: "http://box/v1",
        model: "auto",
        apiKey: "",
      }),
    ).toBe(false);
    expect(
      isRemoteSpeechConfigured({
        ...base,
        provider: "custom",
        endpoint: "http://box/v1",
        model: "large",
        apiKey: "",
      }),
    ).toBe(true);
  });

  test("formats stored speech model labels, including legacy ones", () => {
    expect(formatTranscriptionSpeechModel("")).toBeNull();
    expect(formatTranscriptionSpeechModel("remote:groq:whisper-x")).toBe(
      "Groq · whisper-x",
    );
    expect(formatTranscriptionSpeechModel("remote:deepgram")).toBe(
      "Deepgram · nova-3",
    );
    expect(formatTranscriptionSpeechModel("remote:custom")).toBe("Custom");
    expect(formatTranscriptionSpeechModel("Remote (nova-3)")).toBe(
      "Deepgram · nova-3",
    );
    expect(formatTranscriptionSpeechModel("remote(mystery)")).toBe("mystery");
    expect(formatTranscriptionSpeechModel(" parakeet_v3 ")).toBe("parakeet_v3");
  });

  test("detects remote speech models", () => {
    expect(isRemoteTranscriptionSpeechModel("remote:openai:x")).toBe(true);
    expect(isRemoteTranscriptionSpeechModel(" Remote (x)")).toBe(true);
    expect(isRemoteTranscriptionSpeechModel("whisper_small")).toBe(false);
  });
});
