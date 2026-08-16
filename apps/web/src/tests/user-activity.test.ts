import assert from "node:assert/strict";
import test from "node:test";
import {
	type ActivityDay,
	getActivityStats,
	readActivityCache,
	writeActivityCache,
} from "$lib/user-activity";

function day(date: string, requests = 0, tokens = 0): ActivityDay {
	return {
		date,
		tokens,
		inputTokens: tokens,
		outputTokens: 0,
		cacheReadTokens: 0,
		cacheWriteTokens: 0,
		requests,
		generationRequests: 0,
		cost: 0,
		successCount: requests,
		errorCount: 0,
	};
}

function withLocalStorage(values: Map<string, string>, run: () => void) {
	const original = globalThis.localStorage;
	const storage = {
		get length() {
			return values.size;
		},
		clear: () => values.clear(),
		getItem: (key: string) => values.get(key) ?? null,
		key: (index: number) => [...values.keys()][index] ?? null,
		removeItem: (key: string) => {
			values.delete(key);
		},
		setItem: (key: string, value: string) => {
			values.set(key, value);
		},
	};
	Object.defineProperty(globalThis, "localStorage", {
		configurable: true,
		value: storage,
	});
	try {
		run();
	} finally {
		Object.defineProperty(globalThis, "localStorage", {
			configurable: true,
			value: original,
		});
	}
}

test("activity stats calculate current and longest streaks", () => {
	const stats = getActivityStats([
		day("2026-08-10", 1, 10),
		day("2026-08-11", 1, 20),
		day("2026-08-12"),
		day("2026-08-13", 1, 30),
		day("2026-08-14", 1, 40),
		day("2026-08-15"),
	]);

	assert.equal(stats.activeDays, 4);
	assert.equal(stats.currentStreak, 2);
	assert.equal(stats.longestStreak, 2);
	assert.equal(stats.peakDay?.date, "2026-08-14");
	assert.equal(stats.inputTokens, 100);
});

test("activity stats handle an empty range", () => {
	const stats = getActivityStats([]);
	assert.equal(stats.totalTokens, 0);
	assert.equal(stats.totalRequests, 0);
	assert.equal(stats.currentStreak, 0);
	assert.equal(stats.longestStreak, 0);
	assert.equal(stats.peakDay, null);
	assert.equal(stats.successRate, null);
});

test("activity cache stores daily aggregates", () => {
	const values = new Map<string, string>();
	withLocalStorage(values, () => {
		const activityDays = [day("2026-08-16", 2, 100)];
		const rankings = {
			llmModels: [
				{
					provider: "openai",
					model: "gpt-5",
					totalTokens: 100,
					requestCount: 2,
				},
			],
			generationModels: [],
			works: [],
		};
		writeActivityCache("user-1", {
			days: 1,
			activityDays,
			range: {
				from: "2026-08-16T00:00:00.000Z",
				to: "2026-08-17T00:00:00.000Z",
			},
			rankings,
		});
		const cached = readActivityCache("user-1", 1);
		assert.deepEqual(cached?.activityDays, activityDays);
		assert.deepEqual(cached?.rankings, rankings);
		assert.doesNotMatch([...values.values()][0], /hourly/);
	});
});

test("invalid activity cache is removed", () => {
	const values = new Map([
		[
			"cohub:activity:v1:user-1:90",
			JSON.stringify({ updatedAt: Date.now(), data: { hourly: null } }),
		],
	]);
	withLocalStorage(values, () => {
		assert.equal(readActivityCache("user-1", 90), null);
		assert.equal(values.size, 0);
	});
});
