export type PillStatus = "idle" | "listening" | "processing" | "error";
export type PillTone = "default" | "cleanup";

export type PillStatePayload = {
    status: PillStatus;
};

export type AudioSpectrumPayload = {
    bins: number[];
};

export type PillModePayload = {
    expanded: boolean;
    text?: string;
    tone?: PillTone;
};

export type PillHoverPayload = {
    hovering: boolean;
};
