export type PillStatus = "idle" | "listening" | "processing" | "error";

export type PillStatePayload = {
    status: PillStatus;
};

export type AudioSpectrumPayload = {
    bins: number[];
};

export type PillModePayload = {
    expanded: boolean;
    text?: string;
};
