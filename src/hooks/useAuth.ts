import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { ConvexAuthProvider, useAuthActions } from "@convex-dev/auth/react";
import { useConvexAuth, useQuery } from "convex/react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { api } from "../lib/convexApi";
import { convex } from "../lib/convex";
import { registerCurrentSessionMetadata, type User } from "../lib/auth";

interface AuthContextValue {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  signIn: (provider: string, params?: Record<string, unknown>) => Promise<void>;
  signOut: () => Promise<void>;
  cancelSignIn: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);
const AUTH_PROVIDERS = new Set(["google", "github"]);
const AUTH_CALLBACK_EVENT = "auth:callback-code";
const AUTH_CALLBACK_PATH = "glimpse://callback/auth";

type ConvexAuthSignInResult = {
  redirect?: URL;
  signingIn: boolean;
};

type OAuthStartSignIn = (
  provider: string,
  params?: Record<string, unknown>,
) => Promise<ConvexAuthSignInResult>;

type OAuthCodeExchange = (
  provider: string | undefined,
  params?: Record<string, unknown>,
) => Promise<ConvexAuthSignInResult>;

async function startDesktopOAuthSignIn(
  signIn: OAuthStartSignIn,
  provider: string,
  params?: Record<string, unknown>,
) {
  // Convex Auth only exposes manual redirect handling via its React Native
  // branch, so isolate that desktop compatibility shim here.
  const originalDescriptor = Object.getOwnPropertyDescriptor(
    navigator,
    "product",
  );

  Object.defineProperty(navigator, "product", {
    configurable: true,
    value: "ReactNative",
  });

  try {
    return await signIn(provider, {
      ...(params ?? {}),
      redirectTo: AUTH_CALLBACK_PATH,
    });
  } finally {
    if (originalDescriptor) {
      Object.defineProperty(navigator, "product", originalDescriptor);
    } else {
      Reflect.deleteProperty(navigator, "product");
    }
  }
}

function AuthInner({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const { signIn, signOut } = useAuthActions();
  const [signingIn, setSigningIn] = useState(false);
  const currentUser = useQuery(
    api.users.currentUser,
    isAuthenticated ? {} : "skip",
  ) as User | null | undefined;
  const sessionMetadataUserRef = useRef<string | null>(null);
  const processingCallbackCodeRef = useRef<string | null>(null);
  const attemptSequenceRef = useRef(0);
  const activeAttemptRef = useRef<number | null>(null);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;

    const completeSignIn = async (code: string) => {
      if (!code || processingCallbackCodeRef.current === code) {
        return;
      }
      const attemptId = activeAttemptRef.current;
      if (attemptId === null) {
        return;
      }

      processingCallbackCodeRef.current = code;
      setSigningIn(true);

      try {
        await (signIn as OAuthCodeExchange)(undefined, { code });
      } catch (err) {
        console.error("OAuth callback failed:", err);
      } finally {
        const isActiveAttempt = activeAttemptRef.current === attemptId;
        if (isActiveAttempt) {
          activeAttemptRef.current = null;
        }
        if (!disposed && isActiveAttempt) {
          setSigningIn(false);
        }
        if (processingCallbackCodeRef.current === code) {
          processingCallbackCodeRef.current = null;
        }
      }
    };

    void listen<string>(AUTH_CALLBACK_EVENT, (event) => {
      void completeSignIn(event.payload);
    })
      .then((fn) => {
        if (disposed) {
          fn();
        } else {
          unlisten = fn;
        }
      })
      .catch((err) => {
        console.error("Failed to listen for auth callbacks:", err);
      });

    void invoke<string | null>("take_pending_auth_callback_code")
      .then((code) => {
        if (code) {
          void completeSignIn(code);
        }
      })
      .catch((err) => {
        console.error("Failed to read pending auth callback:", err);
      });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [signIn]);

  useEffect(() => {
    if (!isAuthenticated || !currentUser?._id) {
      sessionMetadataUserRef.current = null;
      return;
    }
    if (sessionMetadataUserRef.current === currentUser._id) {
      return;
    }
    void registerCurrentSessionMetadata()
      .then(() => {
        sessionMetadataUserRef.current = currentUser._id;
      })
      .catch((err) => {
        console.error("Failed to register session metadata:", err);
      });
  }, [isAuthenticated, currentUser?._id]);

  const value = useMemo(
    () => ({
      user: currentUser ?? null,
      isLoading:
        isLoading || signingIn || (isAuthenticated && currentUser === undefined),
      isAuthenticated,
      signIn: async (provider: string, params?: Record<string, unknown>) => {
        if (signingIn) {
          return;
        }

        if (!AUTH_PROVIDERS.has(provider)) {
          throw new Error(`Unsupported auth provider: ${provider}`);
        }

        const attemptId = attemptSequenceRef.current + 1;
        attemptSequenceRef.current = attemptId;
        activeAttemptRef.current = attemptId;
        setSigningIn(true);
        try {
          const result = await startDesktopOAuthSignIn(
            signIn as unknown as OAuthStartSignIn,
            provider,
            params,
          );
          if (activeAttemptRef.current !== attemptId) {
            return;
          }
          if (result.redirect) {
            await openUrl(result.redirect.toString());
            return;
          }
          activeAttemptRef.current = null;
          setSigningIn(false);
        } catch (err) {
          if (activeAttemptRef.current === attemptId) {
            activeAttemptRef.current = null;
          }
          setSigningIn(false);
          throw err;
        }
      },
      signOut: async () => {
        await signOut();
      },
      cancelSignIn: async () => {
        attemptSequenceRef.current += 1;
        activeAttemptRef.current = null;
        setSigningIn(false);
      },
    }),
    [currentUser, isAuthenticated, isLoading, signIn, signOut, signingIn],
  );

  return createElement(AuthContext.Provider, { value }, children);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const inner = createElement(AuthInner, null, children);
  return createElement(
    ConvexAuthProvider,
    {
      client: convex,
      shouldHandleCode: false,
      children: inner,
    } as any,
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
}
