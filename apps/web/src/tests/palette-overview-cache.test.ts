import assert from "node:assert/strict";
import { test } from "node:test";
import {
	isOverviewSnapshotExpired,
	isOverviewSnapshotStale,
} from "../lib/command-palette/palette-overview-staleness";

const NOW = 1_800_000_000_000;

test("fresh snapshot with no invalidation is not stale", () => {
	assert.equal(
		isOverviewSnapshotStale({
			cachedAt: NOW - 10_000,
			invalidatedAt: 0,
			now: NOW,
		}),
		false,
	);
});

test("snapshot older than the freshness window is stale", () => {
	assert.equal(
		isOverviewSnapshotStale({
			cachedAt: NOW - 61_000,
			invalidatedAt: 0,
			now: NOW,
		}),
		true,
	);
});

test("viewer activity after caching marks the snapshot stale (the hi-in-foreign-space bug)", () => {
	const cachedAt = NOW - 5_000;
	// Before sending: fresh.
	assert.equal(
		isOverviewSnapshotStale({ cachedAt, invalidatedAt: 0, now: NOW }),
		false,
	);
	// After sending a message (invalidation timestamped later): stale even
	// though the TTL window has not elapsed.
	assert.equal(
		isOverviewSnapshotStale({
			cachedAt,
			invalidatedAt: NOW - 1_000,
			now: NOW,
		}),
		true,
	);
});

test("invalidation older than the snapshot does not mark it stale (refetch won)", () => {
	assert.equal(
		isOverviewSnapshotStale({
			cachedAt: NOW - 1_000,
			invalidatedAt: NOW - 5_000,
			now: NOW,
		}),
		false,
	);
});

test("hard expiry drops the snapshot entirely", () => {
	assert.equal(
		isOverviewSnapshotExpired({ cachedAt: NOW - 11 * 60_000, now: NOW }),
		true,
	);
	assert.equal(
		isOverviewSnapshotExpired({ cachedAt: NOW - 60_000, now: NOW }),
		false,
	);
});
