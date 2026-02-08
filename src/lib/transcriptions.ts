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
    const stats = getCachedUsageStats(userId) ?? EMPTY_USAGE;
    setCachedUsageStats(userId, stats);
    return stats;
}
