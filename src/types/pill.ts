export type PillStatus = "idle" | "listening" | "processing" | "error";

export type PillStatePayload = {
  status: PillStatus;
};
