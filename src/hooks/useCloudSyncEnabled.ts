import { useCallback, useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";

type UseCloudSyncEnabledOptions = {
    enabled?: boolean;
};

export function useCloudSyncEnabled(options: UseCloudSyncEnabledOptions = {}) {
    const resolveEnabled = useCallback(() => {
        if (typeof options.enabled === "boolean") {
            return options.enabled;
        }
        try {
            if (typeof localStorage === "undefined") {
                return false;
            }
            const stored = localStorage.getItem("glimpse_cloud_sync_enabled");
            return stored === "true";
        } catch {
            return false;
        }
    }, [options.enabled]);

    const [cloudSyncEnabled, setCloudSyncEnabled] = useState(resolveEnabled);

    useEffect(() => {
        setCloudSyncEnabled(resolveEnabled());

        const handleStorageChange = (e: StorageEvent) => {
            if (e.key === "glimpse_cloud_sync_enabled") {
                setCloudSyncEnabled(e.newValue === "true");
            }
        };

        window.addEventListener("storage", handleStorageChange);

        let unlisten: (() => void) | null = null;
        listen("auth:changed", () => {
            setCloudSyncEnabled(resolveEnabled());
        }).then((fn) => {
            unlisten = fn;
        });

        return () => {
            window.removeEventListener("storage", handleStorageChange);
            unlisten?.();
        };
    }, [resolveEnabled]);

    return { cloudSyncEnabled, setCloudSyncEnabled };
}
