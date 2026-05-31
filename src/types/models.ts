export type ModelInfo = {
    key: string;
    label: string;
    description: string;
    size_mb: number;
    file_count: number;
    engine_id: string;
    engine: string;
    variant: string;
    tags: string[];
    capabilities: string[];
    supported_languages: {
        code: string;
        name: string;
    }[];
};

export type SpeechModel = {
    id: string;
    key: string;
    label: string;
    description: string;
    size_mb: number;
    file_count: number;
    engine_id: string;
    engine: string;
    variant: string;
    tags: string[];
    capabilities: string[];
    supported_languages: {
        code: string;
        name: string;
    }[];
    remote: boolean;
    installed: boolean;
    loaded: boolean;
};

export type ModelStatus = {
    key: string;
    installed: boolean;
    bytes_on_disk: number;
    missing_files: string[];
    directory: string;
};

export type DownloadProgressPayload = {
    model: string;
    file: string;
    downloaded: number;
    total: number;
    percent: number;
};

export type DownloadEvent =
    | { status: "idle"; percent: number; downloaded: number; total: number; file?: string }
    | { status: "downloading"; percent: number; downloaded: number; total: number; file: string }
    | { status: "complete"; percent: number; downloaded: number; total: number }
    | { status: "cancelled"; percent: number; downloaded: number; total: number }
    | { status: "error"; percent: number; downloaded: number; total: number; message: string };

export type LocalApiLogEntry = {
    id: number;
    timestamp_ms: number;
    level: string;
    message: string;
};

export type LocalApiStatus = {
    running: boolean;
    host: string;
    port: number;
    model: string;
    loaded_model: string | null;
    api_key_required: boolean;
    config_id: number | null;
    cors: boolean;
    requests_total: number;
    logs: LocalApiLogEntry[];
};

export type CliInstallStatus = {
    installed: boolean;
    sourceAvailable: boolean;
    installPath: string | null;
    sourcePath: string | null;
    command: string;
    pathInShell: boolean;
};
