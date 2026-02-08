export type PillStatus = "idle" | "listening" | "processing" | "error";

export type PillStatePayload = {
    status: PillStatus;
    mode?: string;
};

export type AudioSpectrumPayload = {
    bins: number[];
};

export type TranscriptionPreviewPayload = {
    text: string;
};
