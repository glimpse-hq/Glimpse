import { api } from "./convexApi";
import { convex } from "./convex";

export type CloudUsageStats = {
  availableSeconds: number;
  creditSeconds: number;
  lifetimePurchasedSeconds: number;
  lifetimeTranscriptionsCount: number;
  lifetimeUsedSeconds: number;
  monthTranscriptionsCount: number;
  monthUsedSeconds: number;
  reservedSeconds: number;
  updatedAt: number | null;
};

const USAGE_CACHE_KEY = "glimpse_cloud_usage_cache";

type UsageCache = {
  stats: CloudUsageStats;
  userId: string;
  monthKey: string;
};

/**
 * Create a `YYYY-MM` key for the current year and month.
 *
 * @returns A string in the format `YYYY-MM` representing the current local year and month, with the month zero-padded to two digits.
 */
function getMonthKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * Cache cloud usage stats for a user in localStorage for the current month.
 *
 * Stores a UsageCache object (containing `stats`, `userId`, and the current month key)
 * under the `USAGE_CACHE_KEY` localStorage key.
 *
 * @param userId - The identifier of the user whose usage stats are being cached
 * @param stats - The cloud usage metrics to store for the user
 */
function setCachedUsageStats(userId: string, stats: CloudUsageStats): void {
  const cache: UsageCache = {
    stats,
    userId,
    monthKey: getMonthKey(),
  };
  localStorage.setItem(USAGE_CACHE_KEY, JSON.stringify(cache));
}

/**
 * Retrieve cached cloud usage stats for the current month if they belong to the given user.
 *
 * @returns `CloudUsageStats` if a valid cache for the current month and user exists, `null` otherwise.
 */
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

/**
 * Fetches cloud usage metrics for the specified user, caches the computed result, and returns it.
 *
 * @param userId - The identifier of the user whose usage stats are requested and stored in the cache
 * @returns An object containing the user's cloud usage metrics: `availableSeconds`, `creditSeconds`, `lifetimePurchasedSeconds`, `lifetimeTranscriptionsCount`, `lifetimeUsedSeconds`, `monthTranscriptionsCount`, `monthUsedSeconds`, `reservedSeconds`, and `updatedAt`. Numeric metrics default to `0` when absent; `updatedAt` is `null` when unavailable.
export async function getCloudUsageStats(userId: string): Promise<CloudUsageStats> {
  const wallet = ((await convex.query(api.wallets.getWallet, {})) ?? {}) as Partial<CloudUsageStats> & {
    creditSeconds?: number;
    lifetimePurchasedSeconds?: number;
    lifetimeTranscriptionsCount?: number;
    lifetimeUsedSeconds?: number;
    monthTranscriptionsCount?: number;
    monthUsedSeconds?: number;
    reservedSeconds?: number;
    updatedAt?: number | null;
  };

  const stats: CloudUsageStats = {
    availableSeconds: Math.max(
      0,
      (wallet.creditSeconds ?? 0) - (wallet.reservedSeconds ?? 0),
    ),
    creditSeconds: wallet.creditSeconds ?? 0,
    lifetimePurchasedSeconds: wallet.lifetimePurchasedSeconds ?? 0,
    lifetimeTranscriptionsCount: wallet.lifetimeTranscriptionsCount ?? 0,
    lifetimeUsedSeconds: wallet.lifetimeUsedSeconds ?? 0,
    monthTranscriptionsCount: wallet.monthTranscriptionsCount ?? 0,
    monthUsedSeconds: wallet.monthUsedSeconds ?? 0,
    reservedSeconds: wallet.reservedSeconds ?? 0,
    updatedAt: wallet.updatedAt ?? null,
  };

  setCachedUsageStats(userId, stats);
  return stats;
}
