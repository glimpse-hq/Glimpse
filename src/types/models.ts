export type ModelInfo = {
  key: string;
  label: string;
  description: string;
  size_mb: number;
  engine_id: string;
  family: string;
  variant: string;
  category: string;
  downloadable: boolean;
  tags: string[];
  capabilities: string[];
  supported_languages: {
    code: string;
    name: string;
  }[];
  ane_size_mb: number | null;
};

export type SpeechModel = {
  id: string;
  key: string;
  label: string;
  description: string;
  size_mb: number;
  engine_id: string;
  variant: string;
  tags: string[];
  capabilities: string[];
  supported_languages: {
    code: string;
    name: string;
  }[];
  remote: boolean;
  installed: boolean;
};

export type ModelStatus = {
  key: string;
  installed: boolean;
  ane_installed: boolean;
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
  verifying: boolean;
};

export type AneCompileEvent = {
  model: string;
  label: string;
  status: "start" | "done" | "error";
};

export type DownloadEvent =
  | { status: "idle"; percent: number; file?: string }
  | {
      status: "downloading";
      percent: number;
      file: string;
      verifying?: boolean;
    }
  | { status: "complete"; percent: number }
  | { status: "cancelled"; percent: number }
  | { status: "error"; percent: number; message: string };

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
  managedByApp: boolean;
  sourceAvailable: boolean;
  installPath: string | null;
  sourcePath: string | null;
  command: string;
  pathInShell: boolean;
};
