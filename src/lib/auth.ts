import { invoke } from "@tauri-apps/api/core";
import { api } from "./convexApi";
import { convex } from "./convex";

export type User = {
  _id: string;
  authProviders?: string[];
  name?: string;
  email?: string;
  image?: string;
  lastSeenAt?: number;
  labels?: string[];
  prefs?: Record<string, unknown>;
};

export type Session = {
  id: string;
  appVersion?: string;
  deviceName?: string;
  current: boolean;
  clientName?: string;
  createdAt?: number;
  expirationTime?: number;
  osName?: string;
  osVersion?: string;
  updatedAt?: number;
};

export type SessionList = {
  total: number;
  sessions: Session[];
};

/**
 * Revokes all other active sessions for the current user.
 */
export async function signOutOtherSessions(): Promise<void> {
  await convex.mutation(api.sessions.revokeOtherSessions, {});
}

/**
 * Fetch the currently authenticated user or indicate that no user is signed in.
 *
 * @returns The current `User` object, or `null` if no user is signed in.
 */
export async function getCurrentUser(): Promise<User | null> {
  return (await convex.query(api.users.currentUser, {})) ?? null;
}

/**
 * Update the current user's display name.
 *
 * @param name - The new display name for the user
 * @returns The updated `User` object
 */
export async function updateName(name: string): Promise<User> {
  return await convex.mutation(api.users.updateName, { name });
}

/**
 * Fetches the current user's sessions and returns them in a normalized SessionList.
 *
 * @returns An object containing `total` (the number of sessions) and `sessions` (an array of session objects). Each session includes `id`, `appVersion?`, `deviceName?`, `clientName?`, `createdAt`, `current`, `expirationTime?`, `osName?`, `osVersion?`, and `updatedAt?`.
 */
export async function listSessions(): Promise<SessionList> {
  const sessions = (await convex.query(api.sessions.listUserSessions, {})) as Array<{
    appVersion?: string;
    clientName?: string;
    deviceName?: string;
    _id: string;
    _creationTime: number;
    current: boolean;
    expirationTime?: number;
    osName?: string;
    osVersion?: string;
    updatedAt?: number;
  }>;

  return {
    total: sessions.length,
    sessions: sessions.map((session) => ({
      id: session._id,
      appVersion: session.appVersion,
      deviceName: session.deviceName,
      current: session.current,
      clientName: session.clientName,
      createdAt: session._creationTime,
      expirationTime: session.expirationTime,
      osName: session.osName,
      osVersion: session.osVersion,
      updatedAt: session.updatedAt,
    })),
  };
}

/**
 * Detects the operating system name from platform and user agent strings.
 *
 * @param platform - Optional platform identifier (for example `navigator.platform`)
 * @param userAgent - Optional user agent string (for example `navigator.userAgent`)
 * @returns `macOS`, `Windows`, or `Linux` when those OS names can be inferred; otherwise returns the original `platform` value if present, or `undefined`
 */
function detectOsName(platform?: string, userAgent?: string) {
  const normalizedPlatform = (platform ?? "").toLowerCase();
  const normalizedUserAgent = (userAgent ?? "").toLowerCase();
  if (normalizedPlatform.includes("mac") || normalizedUserAgent.includes("mac os")) {
    return "macOS";
  }
  if (normalizedPlatform.includes("win") || normalizedUserAgent.includes("windows")) {
    return "Windows";
  }
  if (normalizedPlatform.includes("linux") || normalizedUserAgent.includes("linux")) {
    return "Linux";
  }
  return platform || undefined;
}

/**
 * Extracts the operating system version string from a user agent when the OS name is known.
 *
 * @param osName - The normalized OS name (e.g., "macOS" or "Windows"); function returns undefined for other values.
 * @param userAgent - The full user agent string to parse for a version pattern.
 * @returns The OS version string (e.g., "10.15.7" or "10.0") if found, `undefined` otherwise.
 */
function detectOsVersion(osName: string | undefined, userAgent?: string) {
  if (!osName || !userAgent) {
    return undefined;
  }
  if (osName === "macOS") {
    const match = userAgent.match(/Mac OS X ([0-9_]+)/i);
    return match?.[1]?.replace(/_/g, ".");
  }
  if (osName === "Windows") {
    const match = userAgent.match(/Windows NT ([0-9.]+)/i);
    return match?.[1];
  }
  return undefined;
}

/**
 * Registers or updates metadata for the current session with the backend.
 *
 * Collects the operating system name and version, a derived device name, and the application version (when available), then sends these values to the server to upsert the current session's metadata.
 */
export async function registerCurrentSessionMetadata(): Promise<void> {
  const userAgent =
    typeof navigator !== "undefined" ? navigator.userAgent : undefined;
  const platform =
    typeof navigator !== "undefined" ? navigator.platform : undefined;
  const osName = detectOsName(platform, userAgent);
  const osVersion = detectOsVersion(osName, userAgent);
  const deviceName =
    osName === "macOS"
      ? "Mac"
      : osName === "Windows"
        ? "Windows PC"
        : osName === "Linux"
          ? "Linux PC"
          : platform || undefined;

  let appVersion: string | undefined;
  try {
    const info = await invoke<{ version?: string }>("get_app_info");
    appVersion = typeof info?.version === "string" ? info.version : undefined;
  } catch {
    appVersion = undefined;
  }

  await convex.mutation(api.sessions.upsertCurrentSessionMetadata, {
    appVersion,
    clientName: "Glimpse Desktop",
    deviceName,
    osName,
    osVersion,
  });
}

/**
 * Revokes a user session identified by the given session ID.
 *
 * @param sessionId - The ID of the session to revoke
 */
export async function deleteSessionById(sessionId: string): Promise<void> {
  await convex.mutation(api.sessions.revokeSession, { sessionId });
}
