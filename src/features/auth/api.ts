import { emit } from "@tauri-apps/api/event";

export type User = {
  $id: string;
  $createdAt: string;
  $updatedAt: string;
  name: string;
  email: string;
  labels: string[];
  prefs: Record<string, unknown>;
};

export type Session = {
  $id: string;
  current: boolean;
  osName: string;
  clientName: string;
  countryName: string;
};

export type SessionList = {
  total: number;
  sessions: Session[];
};

function emitAuthChanged() {
  emit("auth:changed").catch(() => {});
}

function cloudDisabledError() {
  return new Error("Cloud account features are currently unavailable.");
}

export async function logout(): Promise<void> {
  emitAuthChanged();
}

export async function logoutAll(): Promise<void> {
  emitAuthChanged();
}

export async function getCurrentUser(): Promise<User | null> {
  return null;
}

export async function updateName(_name: string): Promise<User> {
  throw cloudDisabledError();
}

export async function updatePassword(
  _newPassword: string,
  _oldPassword: string,
): Promise<User> {
  throw cloudDisabledError();
}

export async function listSessions(): Promise<SessionList> {
  return { total: 0, sessions: [] };
}

export async function deleteSessionById(_sessionId: string): Promise<void> {}

// Cloud usage stats (localStorage cache)

export type CloudUsageStats = {
  cloud_minutes_this_month: number;
  cloud_hours_lifetime: number;
  cloud_transcriptions_count: number;
  cloud_transcriptions_this_month: number;
};

const USAGE_CACHE_KEY = "glimpse_cloud_usage_cache";

const EMPTY_USAGE: CloudUsageStats = {
  cloud_minutes_this_month: 0,
  cloud_hours_lifetime: 0,
  cloud_transcriptions_count: 0,
  cloud_transcriptions_this_month: 0,
};

type UsageCache = {
  stats: CloudUsageStats;
  userId: string;
  monthKey: string;
};

function getMonthKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function setCachedUsageStats(userId: string, stats: CloudUsageStats): void {
  const cache: UsageCache = { stats, userId, monthKey: getMonthKey() };
  localStorage.setItem(USAGE_CACHE_KEY, JSON.stringify(cache));
}

export function getCachedUsageStats(userId: string): CloudUsageStats | null {
  try {
    const cached = localStorage.getItem(USAGE_CACHE_KEY);
    if (!cached) return null;
    const data: UsageCache = JSON.parse(cached);
    if (data.userId !== userId || data.monthKey !== getMonthKey()) {
      localStorage.removeItem(USAGE_CACHE_KEY);
      return null;
    }
    return data.stats;
  } catch {
    return null;
  }
}

export async function getCloudUsageStats(
  userId: string,
): Promise<CloudUsageStats> {
  const stats = getCachedUsageStats(userId) ?? EMPTY_USAGE;
  setCachedUsageStats(userId, stats);
  return stats;
}
