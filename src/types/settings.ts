export type TranscriptionMode = "cloud" | "local";
export type TextSizeMode = "small" | "default" | "large";
export type AppLocaleSetting = "system" | string;

export type RecordingPrunePolicy =
    | "never"
    | "immediately"
    | "day"
    | "week"
    | "month"
    | "three_months"
    | "year";

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
    app_locale: AppLocaleSetting;
    llm_enabled: boolean;
    cleanup_enabled: boolean;
    llm_provider: LlmProvider;
    llm_endpoint: string;
    llm_api_key: string;
    llm_model: string;
    user_name: string;
    dictionary: string[];
    replacements: Replacement[];
    personalities: Personality[];
    edit_mode_enabled: boolean;
    media_control_enabled: boolean;
    auto_update_enabled: boolean;
    recording_prune_policy: RecordingPrunePolicy;
    analytics_enabled: boolean;
    analytics_install_id: string;
};
