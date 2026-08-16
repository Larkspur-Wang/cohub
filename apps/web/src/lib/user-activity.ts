import type {
	SpaceUsageResponse,
	UserUsageRange,
	UserUsageRankings,
} from "@neta-art/cohub";

export type ActivityDay = {
	date: string;
	tokens: number;
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens: number;
	cacheWriteTokens: number;
	requests: number;
	generationRequests: number;
	cost: number;
	successCount: number;
	errorCount: number;
};

export type ActivitySnapshot = {
	days: number;
	updatedAt: number;
	activityDays: ActivityDay[];
	range: UserUsageRange;
	rankings: UserUsageRankings;
};

const CACHE_PREFIX = "cohub:activity:v1";
const CACHE_TTL_MS = 30 * 60 * 1000;
const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const dayFormatter = new Intl.DateTimeFormat("en-CA", {
	year: "numeric",
	month: "2-digit",
	day: "2-digit",
});
const ACTIVITY_DAY_NUMBER_KEYS = [
	"tokens",
	"inputTokens",
	"outputTokens",
	"cacheReadTokens",
	"cacheWriteTokens",
	"requests",
	"generationRequests",
	"cost",
	"successCount",
	"errorCount",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasFiniteNumbers(
	value: Record<string, unknown>,
	keys: readonly string[],
) {
	return keys.every(
		(key) => typeof value[key] === "number" && Number.isFinite(value[key]),
	);
}

function isActivityDay(value: unknown): value is ActivityDay {
	if (!isRecord(value) || typeof value.date !== "string") return false;
	return (
		Number.isFinite(new Date(`${value.date}T12:00:00`).getTime()) &&
		hasFiniteNumbers(value, ACTIVITY_DAY_NUMBER_KEYS)
	);
}

function isRankings(value: unknown): value is UserUsageRankings {
	if (
		!isRecord(value) ||
		!Array.isArray(value.llmModels) ||
		!Array.isArray(value.generationModels) ||
		!Array.isArray(value.works)
	)
		return false;
	return (
		value.llmModels.every(
			(row) =>
				isRecord(row) &&
				typeof row.provider === "string" &&
				typeof row.model === "string" &&
				hasFiniteNumbers(row, ["totalTokens", "requestCount"]),
		) &&
		value.generationModels.every(
			(row) =>
				isRecord(row) &&
				typeof row.provider === "string" &&
				typeof row.model === "string" &&
				hasFiniteNumbers(row, ["requestCount"]),
		) &&
		value.works.every(
			(row) =>
				isRecord(row) &&
				typeof row.workId === "string" &&
				typeof row.spaceId === "string" &&
				typeof row.title === "string" &&
				typeof row.slug === "string" &&
				hasFiniteNumbers(row, ["viewCount"]),
		)
	);
}

function isRange(value: unknown): value is UserUsageRange {
	return (
		isRecord(value) &&
		typeof value.from === "string" &&
		typeof value.to === "string"
	);
}

function cacheKey(userUuid: string, days: number) {
	return `${CACHE_PREFIX}:${userUuid}:${days}`;
}

function removeCacheKey(key: string) {
	try {
		localStorage.removeItem(key);
	} catch {
		// Ignore storage cleanup failures.
	}
}

export function readActivityCache(
	userUuid: string,
	days: number,
): ActivitySnapshot | null {
	if (typeof localStorage === "undefined" || !userUuid) return null;
	const key = cacheKey(userUuid, days);
	try {
		const value = JSON.parse(
			localStorage.getItem(key) ?? "null",
		) as Partial<ActivitySnapshot> | null;
		if (
			!value ||
			typeof value.updatedAt !== "number" ||
			Date.now() - value.updatedAt > CACHE_MAX_AGE_MS ||
			!Array.isArray(value.activityDays) ||
			value.activityDays.length !== days ||
			!value.activityDays.every(isActivityDay) ||
			!isRange(value.range) ||
			!isRankings(value.rankings)
		) {
			removeCacheKey(key);
			return null;
		}
		return {
			days,
			updatedAt: value.updatedAt,
			activityDays: value.activityDays,
			range: value.range,
			rankings: value.rankings,
		};
	} catch {
		removeCacheKey(key);
		return null;
	}
}

export function clearActivityCache(userUuid: string) {
	if (typeof localStorage === "undefined" || !userUuid) return;
	const prefix = `${CACHE_PREFIX}:${userUuid}:`;
	try {
		for (let index = localStorage.length - 1; index >= 0; index -= 1) {
			const key = localStorage.key(index);
			if (key?.startsWith(prefix)) localStorage.removeItem(key);
		}
	} catch {
		// Ignore storage cleanup failures during logout.
	}
}

export function writeActivityCache(
	userUuid: string,
	value: Omit<ActivitySnapshot, "updatedAt">,
) {
	if (typeof localStorage === "undefined" || !userUuid) return;
	try {
		const snapshot = {
			...value,
			updatedAt: Date.now(),
		} satisfies ActivitySnapshot;
		localStorage.setItem(
			cacheKey(userUuid, value.days),
			JSON.stringify(snapshot),
		);
	} catch {
		// Usage is still available from the network when storage is unavailable.
	}
}

export function isActivityCacheFresh(snapshot: ActivitySnapshot) {
	return Date.now() - snapshot.updatedAt < CACHE_TTL_MS;
}

function dateKey(date: Date) {
	const parts = dayFormatter.formatToParts(date);
	const get = (type: string) =>
		parts.find((part) => part.type === type)?.value ?? "00";
	return `${get("year")}-${get("month")}-${get("day")}`;
}

function addDays(date: Date, amount: number) {
	const result = new Date(date);
	result.setDate(result.getDate() + amount);
	return result;
}

export function buildActivityDays(
	data: SpaceUsageResponse,
	days: number,
): ActivityDay[] {
	const map = new Map<string, ActivityDay>();
	const ensure = (key: string) => {
		const existing = map.get(key);
		if (existing) return existing;
		const created = {
			date: key,
			tokens: 0,
			inputTokens: 0,
			outputTokens: 0,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
			requests: 0,
			generationRequests: 0,
			cost: 0,
			successCount: 0,
			errorCount: 0,
		};
		map.set(key, created);
		return created;
	};

	for (const row of data.hourly) {
		const day = ensure(dateKey(new Date(row.bucketStartAt)));
		day.tokens += row.totalTokens;
		day.inputTokens += row.inputTokens;
		day.outputTokens += row.outputTokens;
		day.cacheReadTokens += row.cacheReadTokens;
		day.cacheWriteTokens += row.cacheWriteTokens;
		day.requests += row.requestCount;
		day.cost += row.costTotal;
		day.successCount += row.successCount;
		day.errorCount += row.errorCount;
	}
	for (const row of data.generation?.hourly ?? []) {
		const day = ensure(dateKey(new Date(row.bucketStartAt)));
		day.requests += row.requestCount;
		day.generationRequests += row.requestCount;
		day.cost += row.costTotal;
		day.successCount += row.successCount;
		day.errorCount += row.errorCount;
	}

	const today = new Date();
	return Array.from({ length: days }, (_, index) => {
		const date = addDays(today, index - days + 1);
		return ensure(dateKey(date));
	});
}

export function getActivityStats(days: ActivityDay[]) {
	const activeDays = days.filter((day) => day.requests > 0);
	const currentStart = days.at(-1)?.requests
		? days.length - 1
		: days.length - 2;
	let currentStreak = 0;
	for (
		let index = currentStart;
		index >= 0 && days[index]?.requests;
		index -= 1
	)
		currentStreak += 1;

	let longestStreak = 0;
	let streak = 0;
	for (const day of days) {
		streak = day.requests ? streak + 1 : 0;
		longestStreak = Math.max(longestStreak, streak);
	}
	const peakDay = activeDays.reduce<ActivityDay | null>(
		(peak, day) => (!peak || day.tokens > peak.tokens ? day : peak),
		null,
	);
	const totalTokens = days.reduce((sum, day) => sum + day.tokens, 0);
	const inputTokens = days.reduce((sum, day) => sum + day.inputTokens, 0);
	const outputTokens = days.reduce((sum, day) => sum + day.outputTokens, 0);
	const cacheReadTokens = days.reduce(
		(sum, day) => sum + day.cacheReadTokens,
		0,
	);
	const cacheWriteTokens = days.reduce(
		(sum, day) => sum + day.cacheWriteTokens,
		0,
	);
	const totalRequests = days.reduce((sum, day) => sum + day.requests, 0);
	const totalGenerationRequests = days.reduce(
		(sum, day) => sum + day.generationRequests,
		0,
	);
	const totalCost = days.reduce((sum, day) => sum + day.cost, 0);
	const successCount = days.reduce((sum, day) => sum + day.successCount, 0);
	const errorCount = days.reduce((sum, day) => sum + day.errorCount, 0);

	return {
		activeDays: activeDays.length,
		currentStreak,
		longestStreak,
		peakDay,
		totalTokens,
		inputTokens,
		outputTokens,
		cacheReadTokens,
		cacheWriteTokens,
		totalRequests,
		totalGenerationRequests,
		totalCost,
		successRate:
			successCount + errorCount > 0
				? successCount / (successCount + errorCount)
				: null,
	};
}

export function formatCompact(value: number) {
	if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`;
	if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
	if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
	return new Intl.NumberFormat("en-US").format(Math.round(value));
}

export function formatCost(value: number) {
	if (!value) return "$0";
	if (value < 0.01) return "<$0.01";
	return new Intl.NumberFormat("en-US", {
		style: "currency",
		currency: "USD",
		maximumFractionDigits: 2,
	}).format(value);
}

export function formatDay(date: string) {
	return new Intl.DateTimeFormat("en-US", {
		month: "short",
		day: "numeric",
		year: "numeric",
	}).format(new Date(`${date}T12:00:00`));
}
