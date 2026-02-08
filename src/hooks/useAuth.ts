import {
    createContext,
    createElement,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
    type ReactNode,
} from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentUser, type User } from "../lib";

interface AuthState {
    user: User | null;
    isLoading: boolean;
    error: string | null;
}

interface AuthContextValue extends AuthState {
    isAuthenticated: boolean;
    isSubscriber: boolean;
    refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
    const [state, setState] = useState<AuthState>({
        user: null,
        isLoading: true,
        error: null,
    });

    const mountedRef = useRef(true);

    const refresh = useCallback(async () => {
        if (!mountedRef.current) return;
        setState((prev) => ({ ...prev, isLoading: true, error: null }));
        try {
            const user = await getCurrentUser();
            if (mountedRef.current) {
                setState({ user, isLoading: false, error: null });
            }
        } catch (err) {
            if (mountedRef.current) {
                setState({
                    user: null,
                    isLoading: false,
                    error: err instanceof Error ? err.message : "Failed to load user",
                });
            }
        }
    }, []);

    useEffect(() => {
        mountedRef.current = true;
        refresh();
        return () => {
            mountedRef.current = false;
        };
    }, [refresh]);

    useEffect(() => {
        let unlisten: UnlistenFn | null = null;
        let mounted = true;
        listen("auth:changed", () => {
            refresh();
        }).then((fn) => {
            if (mounted) {
                unlisten = fn;
            } else {
                fn();
            }
        });

        return () => {
            mounted = false;
            unlisten?.();
        };
    }, [refresh]);

    const value = useMemo(
        () => ({
            ...state,
            isAuthenticated: state.user !== null,
            isSubscriber: state.user?.labels?.includes("cloud") ?? false,
            refresh,
        }),
        [state, refresh]
    );

    return createElement(AuthContext.Provider, { value }, children);
}

export function useAuth() {
    const context = useContext(AuthContext);
    if (!context) {
        throw new Error("useAuth must be used within AuthProvider");
    }
    return context;
}
