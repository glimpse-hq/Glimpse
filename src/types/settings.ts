export type TranscriptionMode = "cloud" | "local";
export type TextSizeMode = "small" | "default" | "large";

export type LlmProvider =
    | "none"
    | "lmstudio"
    | "ollama"
    | "openai"
    | "anthropic"
    | "google"
    | "xai"
    | "groq"
    | "cerebras"
    | "sambanova"
    | "together"
    | "openrouter"
    | "perplexity"
    | "deepseek"
    | "fireworks"
    | "mistral"
    | "custom";

export type Replacement = {
    from: string;
    to: string;
};

export type Personality = {
    id: string;
    name: string;
    enabled: boolean;
    apps: string[];
    websites: string[];
    instructions: string[];
};

export type StoredSettings = {
    onboarding_completed: boolean;
    smart_shortcut: string;
    smart_enabled: boolean;
    hold_shortcut: string;
    hold_enabled: boolean;
    toggle_shortcut: string;
    toggle_enabled: boolean;
    transcription_mode: TranscriptionMode;
    local_model: string;
    microphone_device: string | null;
    language: string;
    llm_cleanup_enabled: boolean;
    llm_provider: LlmProvider;
    llm_endpoint: string;
    llm_api_key: string;
    llm_model: string;
    user_name: string;
    dictionary: string[];
    replacements: Replacement[];
    personalities: Personality[];
    edit_mode_enabled: boolean;
};
