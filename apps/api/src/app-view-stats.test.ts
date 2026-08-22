import assert from "node:assert/strict";
import { test } from "node:test";
import { APP_VIEW_STATS_ACTIVE_REDIS_KEY } from "@cohub/protocol";
import {
  aggregateAppViewStats,
  recordAppViewStatsHourly,
  resolveAppViewSource,
  toUtcHourBucket,
} from "./app-view-stats.js";

test("toUtcHourBucket truncates minutes in UTC", () => {
  assert.equal(
    toUtcHourBucket(new Date("2026-08-07T14:37:42.123Z")).toISOString(),
    "2026-08-07T14:00:00.000Z",
  );
});

test("resolveAppViewSource keeps known callers and groups other API callers", () => {
  assert.equal(resolveAppViewSource({ via: "cli" }, "web"), "cli");
  assert.equal(resolveAppViewSource({ via: "web" }, "api"), "web");
  assert.equal(resolveAppViewSource({ via: "tool" }, "web"), "api");
  assert.equal(resolveAppViewSource(null, "web"), "web");
});

test("recordAppViewStatsHourly increments the shared Redis hash", async () => {
  const calls: unknown[][] = [];
  const recorded = await recordAppViewStatsHourly({
    appId: "11111111-1111-4111-8111-111111111111",
    appVersionId: "22222222-2222-4222-8222-222222222222",
    source: "web",
    viewedAt: new Date("2026-08-07T14:37:42.123Z"),
    redis: {
      status: "ready",
      async hincrby(...args) {
        calls.push(args);
        return 1;
      },
    },
  });
  assert.equal(recorded, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.[0], APP_VIEW_STATS_ACTIVE_REDIS_KEY);
  assert.equal(calls[0]?.[2], 1);
  assert.deepEqual(JSON.parse(String(calls[0]?.[1])), [
    "11111111-1111-4111-8111-111111111111",
    "22222222-2222-4222-8222-222222222222",
    Date.parse("2026-08-07T14:00:00.000Z"),
    "web",
  ]);
});

test("recordAppViewStatsHourly skips immediately when Redis is unavailable", async () => {
  const recorded = await recordAppViewStatsHourly({
    appId: "11111111-1111-4111-8111-111111111111",
    appVersionId: "22222222-2222-4222-8222-222222222222",
    source: "web",
    redis: {
      status: "reconnecting",
      async hincrby() {
        assert.fail("must not queue a stats write while Redis is unavailable");
      },
    },
  });
  assert.equal(recorded, false);
});

test("aggregateAppViewStats returns summaries, zero-filled days, and sources", () => {
  const stats = aggregateAppViewStats({
    totalViews: "42",
    now: new Date("2026-08-07T14:37:00Z"),
    rows: [
      { bucketStartAt: new Date("2026-08-07T14:00:00Z"), source: "web", viewCount: 3 },
      { bucketStartAt: new Date("2026-08-06T15:00:00Z"), source: "cli", viewCount: 2 },
      { bucketStartAt: new Date("2026-08-01T09:00:00Z"), source: "api", viewCount: 5 },
      { bucketStartAt: new Date("2026-07-10T09:00:00Z"), source: "unknown", viewCount: 7 },
    ],
  });

  assert.deepEqual(stats.summary, {
    totalViews: 42,
    views24h: 5,
    views7d: 10,
    views30d: 17,
  });
  assert.equal(stats.daily.length, 30);
  assert.deepEqual(stats.daily[0], { date: "2026-07-09", views: 0 });
  assert.deepEqual(stats.daily.at(-1), { date: "2026-08-07", views: 3 });
  assert.deepEqual(stats.sources, [
    { source: "web", views: 3 },
    { source: "cli", views: 2 },
    { source: "api", views: 12 },
  ]);
});

test("aggregateAppViewStats includes exactly 24 and 168 hourly buckets", () => {
  const stats = aggregateAppViewStats({
    totalViews: 10,
    now: new Date("2026-08-07T14:37:00Z"),
    rows: [
      { bucketStartAt: new Date("2026-08-07T14:00:00Z"), source: "web", viewCount: 1 },
      { bucketStartAt: new Date("2026-08-06T15:00:00Z"), source: "web", viewCount: 2 },
      { bucketStartAt: new Date("2026-08-06T14:00:00Z"), source: "web", viewCount: 3 },
      { bucketStartAt: new Date("2026-07-31T15:00:00Z"), source: "web", viewCount: 4 },
      { bucketStartAt: new Date("2026-07-31T14:00:00Z"), source: "web", viewCount: 5 },
    ],
  });

  assert.equal(stats.summary.views24h, 3);
  assert.equal(stats.summary.views7d, 10);
  assert.equal(stats.summary.views30d, 15);
});
