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
import { emit, listen, type UnlistenFn } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import type { Models } from "appwrite";
import { getCurrentUser, type User } from "../lib";
import { client } from "../lib/appwrite";

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

    const realtimeUnsub = useRef<(() => void) | null>(null);
    const subscribedUserId = useRef<string | null>(null);

    const subscribeToUser = useCallback((userId: string) => {
        if (realtimeUnsub.current && subscribedUserId.current === userId) {
            return;
        }

        realtimeUnsub.current?.();

        try {
            const unsubscribe = client.subscribe<Models.User<Models.Preferences>>(
                "account",
                (event) => {
                    const nextUser = event.payload;
                    if (!nextUser) return;
                    
                    setState((prev) => {
                        const wasSubscriber = prev.user?.labels?.includes("cloud") ?? false;
                        const isSubscriber = nextUser.labels?.includes("cloud") ?? false;

                        if (prev.user && !wasSubscriber && isSubscriber) {
                             invoke("show_celebration_toast").catch(console.error);
                        }
                        
                        return { ...prev, user: nextUser };
                    });
                    
                    emit("auth:changed").catch(() => { });
                }
            );
            realtimeUnsub.current = () => unsubscribe();
            subscribedUserId.current = userId;
        } catch (err) {
            console.error("Failed to subscribe to user updates", err);
        }
    }, []);

    const refresh = useCallback(async () => {
        setState((prev) => ({ ...prev, isLoading: true, error: null }));
        try {
            const user = await getCurrentUser();
            setState({ user, isLoading: false, error: null });
            if (user?.$id) {
                subscribeToUser(user.$id);
            } else {
                realtimeUnsub.current?.();
                realtimeUnsub.current = null;
                subscribedUserId.current = null;
            }
        } catch (err) {
            setState({
                user: null,
                isLoading: false,
                error: err instanceof Error ? err.message : "Failed to load user",
            });
            realtimeUnsub.current?.();
            realtimeUnsub.current = null;
            subscribedUserId.current = null;
        }
    }, [subscribeToUser]);

    useEffect(() => {
        refresh();
        return () => {
            realtimeUnsub.current?.();
            realtimeUnsub.current = null;
        };
    }, [refresh]);

    useEffect(() => {
        let unlisten: UnlistenFn | null = null;
        listen("auth:changed", () => {
            refresh();
        }).then((fn) => {
            unlisten = fn;
        });

        return () => {
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
