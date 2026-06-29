import { describe, expect, mock, test } from "bun:test";

mock.module("@tauri-apps/api/core", () => ({
  invoke: mock(async () => []),
}));

const { modelKeys, resolveSpeechModelLabel } =
  await import("../../src/features/settings/models-queries");

describe("settings model query helpers", () => {
  test("keeps provider credentials out of model query keys", () => {
    const serializedKeys = JSON.stringify([
      modelKeys.all,
      modelKeys.catalog(),
      modelKeys.status("local-model"),
      modelKeys.speech(),
      modelKeys.cli(),
    ]);

    expect(serializedKeys).not.toContain("apiKey");
    expect(serializedKeys).not.toContain("endpoint");
    expect(serializedKeys).not.toContain("llm_api_key");
    expect(serializedKeys).not.toContain("remote_speech_api_key");
    expect("llmModels" in modelKeys).toBe(false);
    expect("remoteSpeechModels" in modelKeys).toBe(false);
  });

  test("resolves speech labels from ids, keys, and static fallbacks", () => {
    const models = [
      { id: "remote:model-a", key: "provider:model-a", label: "Model A" },
      { id: "local:model-b", key: "model-b", label: "Model B" },
    ];

    expect(resolveSpeechModelLabel(models, "remote:model-a")).toBe("Model A");
    expect(resolveSpeechModelLabel(models, "  model-b  ")).toBe("Model B");
    expect(resolveSpeechModelLabel(models, "  ")).toBeNull();
    expect(
      resolveSpeechModelLabel(undefined, "remote:openai:gpt-4o-transcribe"),
    ).toBe("OpenAI · gpt-4o-transcribe");
    expect(resolveSpeechModelLabel(undefined, "unknown-model")).toBe(
      "unknown-model",
    );
  });
});
