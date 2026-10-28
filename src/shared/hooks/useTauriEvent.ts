import { useEffect, useEffectEvent } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

// Calls the latest handler for each event. `onListening` runs once the
// listener is registered, for backends that queue events until then.
export function useTauriEvent<TPayload = unknown>(
  event: string,
  handler: (payload: TPayload) => void,
  options: { enabled?: boolean; onListening?: () => void } = {},
) {
  const { enabled = true } = options;
  const onEvent = useEffectEvent(handler);
  const onListening = useEffectEvent(() => options.onListening?.());

  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    let unlisten: UnlistenFn | null = null;

    listen<TPayload>(event, ({ payload }) => {
      if (!disposed) onEvent(payload);
    })
      .then((fn) => {
        if (disposed) {
          fn();
          return;
        }
        unlisten = fn;
        onListening();
      })
      .catch((error) => {
        console.error(`Failed to listen for ${event}`, error);
      });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [event, enabled]);
}
