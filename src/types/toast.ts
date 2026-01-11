export type ToastType = "error" | "info" | "success" | "warning" | "update" | "celebration";

export type ToastPayload = {
    type: ToastType;
    title?: string;
    message: string;
    autoDismiss?: boolean;
    duration?: number;
    retryId?: string;
    mode?: "local" | "cloud";
    action?: string;
    actionLabel?: string;
};
