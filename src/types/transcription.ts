export type TranscriptionRecord = {
    id: string;
    timestamp: string;
    text: string;
    raw_text?: string | null;
    audio_path: string;
    status: "success" | "error";
    error_message?: string;
    llm_cleaned: boolean;
    speech_model: string;
    llm_model?: string | null;
    word_count: number;
    audio_duration_seconds: number;
    synced: boolean;
    mode_id?: string | null;
    mode_name?: string | null;
};
