import assert from "node:assert/strict";
import { test } from "node:test";
import {
	__resetSpaceGenerationLeaseForTests,
	acquireSpaceGeneration,
	getSpaceGenerationLeaseCount,
	releaseSpaceGeneration,
} from "../lib/features/session-chat/space-generation-lease";

test("second host entering same space does not reset", () => {
	const resets: string[] = [];
	__resetSpaceGenerationLeaseForTests((id) => {
		resets.push(id);
	});
	acquireSpaceGeneration("space-a");
	acquireSpaceGeneration("space-a");
	assert.equal(getSpaceGenerationLeaseCount("space-a"), 2);
	assert.deepEqual(resets, []);
});

test("only last host leaving a space resets it", () => {
	const resets: string[] = [];
	__resetSpaceGenerationLeaseForTests((id) => {
		resets.push(id);
	});
	acquireSpaceGeneration("space-a");
	acquireSpaceGeneration("space-a");
	releaseSpaceGeneration("space-a");
	assert.equal(getSpaceGenerationLeaseCount("space-a"), 1);
	assert.deepEqual(resets, []);
	releaseSpaceGeneration("space-a");
	assert.equal(getSpaceGenerationLeaseCount("space-a"), 0);
	assert.deepEqual(resets, ["space-a"]);
});

test("hosts in different spaces reset independently", () => {
	const resets: string[] = [];
	__resetSpaceGenerationLeaseForTests((id) => {
		resets.push(id);
	});
	acquireSpaceGeneration("space-a");
	acquireSpaceGeneration("space-b");
	releaseSpaceGeneration("space-a");
	assert.deepEqual(resets, ["space-a"]);
	assert.equal(getSpaceGenerationLeaseCount("space-b"), 1);
	releaseSpaceGeneration("space-b");
	assert.deepEqual(resets, ["space-a", "space-b"]);
});

test("empty spaceId is a no-op", () => {
	const resets: string[] = [];
	__resetSpaceGenerationLeaseForTests((id) => {
		resets.push(id);
	});
	acquireSpaceGeneration("");
	releaseSpaceGeneration("");
	assert.deepEqual(resets, []);
});

test("under-release after last host leaves is a no-op", () => {
	const resets: string[] = [];
	__resetSpaceGenerationLeaseForTests((id) => {
		resets.push(id);
	});
	acquireSpaceGeneration("space-a");
	releaseSpaceGeneration("space-a");
	assert.deepEqual(resets, ["space-a"]);
	// Extra releases (dispose after soft-clear, double dispose) must not reset again.
	releaseSpaceGeneration("space-a");
	releaseSpaceGeneration("space-a");
	assert.equal(getSpaceGenerationLeaseCount("space-a"), 0);
	assert.deepEqual(resets, ["space-a"]);
});

// Note: multi-host safety against one host releasing twice while another still holds
// is enforced by host-local leasedSpaceId (releaseGenerationLease), not by refcount alone.

test("release without acquire is a no-op", () => {
	const resets: string[] = [];
	__resetSpaceGenerationLeaseForTests((id) => {
		resets.push(id);
	});
	releaseSpaceGeneration("never-acquired");
	assert.equal(getSpaceGenerationLeaseCount("never-acquired"), 0);
	assert.deepEqual(resets, []);
});

test("host-local lease tracking prevents one host from wiping another", () => {
	const resets: string[] = [];
	__resetSpaceGenerationLeaseForTests((id) => {
		resets.push(id);
	});

	// Mirrors host leasedSpaceId acquire/release helpers.
	class HostLease {
		id: string | null = null;
		acquire(spaceId: string) {
			if (!spaceId || this.id === spaceId) return;
			if (this.id) releaseSpaceGeneration(this.id);
			acquireSpaceGeneration(spaceId);
			this.id = spaceId;
		}
		release() {
			if (!this.id) return;
			releaseSpaceGeneration(this.id);
			this.id = null;
		}
	}

	const a = new HostLease();
	const b = new HostLease();
	a.acquire("space-a");
	b.acquire("space-a");
	assert.equal(getSpaceGenerationLeaseCount("space-a"), 2);

	// Host A soft-clears then dispose — only one release.
	a.release();
	a.release(); // double dispose must be no-op
	assert.equal(getSpaceGenerationLeaseCount("space-a"), 1);
	assert.deepEqual(resets, []);

	// Host B still owns the space; only its leave resets.
	b.release();
	assert.deepEqual(resets, ["space-a"]);
});
