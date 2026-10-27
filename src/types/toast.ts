export type ToastType =
  "error" | "info" | "success" | "warning" | "update" | "celebration";

export type ToastPayload = {
  type: ToastType;
  title?: string;
  message: string;
  autoDismiss?: boolean;
  duration?: number;
  action?: string;
  actionArgs?: Record<string, unknown> | null;
  actionLabel?: string;
  secondaryAction?: string;
  secondaryActionLabel?: string;
};
