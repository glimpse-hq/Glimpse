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

export async function signOutOtherSessions(): Promise<void> {
  await convex.mutation(api.sessions.revokeOtherSessions, {});
}

export async function updateName(name: string): Promise<User> {
  return await convex.mutation(api.users.updateName, { name });
}

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

export async function deleteSessionById(sessionId: string): Promise<void> {
  await convex.mutation(api.sessions.revokeSession, { sessionId });
}
