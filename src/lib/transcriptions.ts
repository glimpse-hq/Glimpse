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

function getMonthKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function setCachedUsageStats(userId: string, stats: CloudUsageStats): void {
  const cache: UsageCache = {
    stats,
    userId,
    monthKey: getMonthKey(),
  };
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
