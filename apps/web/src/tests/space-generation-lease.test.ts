import assert from "node:assert/strict";
import { test } from "node:test";

/**
 * Mirrors space-generation-lease refcount: only the last host leaving a space
 * may reset that space's generation store.
 */
function createLeaseTracker() {
	const leases = new Map<string, number>();
	const resets: string[] = [];

	function acquire(spaceId: string) {
		if (!spaceId) return;
		leases.set(spaceId, (leases.get(spaceId) ?? 0) + 1);
	}

	function release(spaceId: string) {
		if (!spaceId) return;
		const next = (leases.get(spaceId) ?? 0) - 1;
		if (next > 0) {
			leases.set(spaceId, next);
			return;
		}
		leases.delete(spaceId);
		resets.push(spaceId);
	}

	return {
		acquire,
		release,
		count: (spaceId: string) => leases.get(spaceId) ?? 0,
		resets,
	};
}

test("second host entering same space does not reset", () => {
	const lease = createLeaseTracker();
	lease.acquire("space-a");
	lease.acquire("space-a");
	assert.equal(lease.count("space-a"), 2);
	assert.deepEqual(lease.resets, []);
});

test("only last host leaving a space resets it", () => {
	const lease = createLeaseTracker();
	lease.acquire("space-a");
	lease.acquire("space-a");
	lease.release("space-a");
	assert.equal(lease.count("space-a"), 1);
	assert.deepEqual(lease.resets, []);
	lease.release("space-a");
	assert.equal(lease.count("space-a"), 0);
	assert.deepEqual(lease.resets, ["space-a"]);
});

test("hosts in different spaces reset independently", () => {
	const lease = createLeaseTracker();
	lease.acquire("space-a");
	lease.acquire("space-b");
	lease.release("space-a");
	assert.deepEqual(lease.resets, ["space-a"]);
	assert.equal(lease.count("space-b"), 1);
	lease.release("space-b");
	assert.deepEqual(lease.resets, ["space-a", "space-b"]);
});

test("empty spaceId is a no-op", () => {
	const lease = createLeaseTracker();
	lease.acquire("");
	lease.release("");
	assert.deepEqual(lease.resets, []);
});
