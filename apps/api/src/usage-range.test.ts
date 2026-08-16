import assert from "node:assert/strict";
import test from "node:test";
import { InvalidUsageRangeError, resolveUserUsageRange } from "./usage-aggregation.js";

const now = new Date("2026-08-16T12:30:00.000Z");

test("user usage range defaults to 30 rolling days", () => {
  const result = resolveUserUsageRange({}, now);
  assert.equal(result.days, 30);
  assert.equal(result.range.to, now.toISOString());
  assert.equal(result.startDate.toISOString(), "2026-07-17T12:00:00.000Z");
});

test("user usage range treats date-only to as an exclusive UTC boundary", () => {
  const result = resolveUserUsageRange({ from: "2026-08-01", to: "2026-08-08" }, now);
  assert.equal(result.days, 7);
  assert.equal(result.startDate.toISOString(), "2026-08-01T00:00:00.000Z");
  assert.equal(result.endDate.toISOString(), "2026-08-08T00:00:00.000Z");
});

test("user usage range rejects conflicting and unbounded inputs", () => {
  assert.throws(
    () => resolveUserUsageRange({ days: "30", from: "2026-08-01" }, now),
    InvalidUsageRangeError,
  );
  assert.throws(
    () => resolveUserUsageRange({ to: "2026-08-08" }, now),
    InvalidUsageRangeError,
  );
  assert.throws(
    () => resolveUserUsageRange({ from: "2026-02-30" }, now),
    InvalidUsageRangeError,
  );
  assert.throws(
    () => resolveUserUsageRange({ from: "2025-01-01", to: "2026-08-08" }, now),
    /cannot exceed 366 days/,
  );
});

test("user usage range accepts 366 days and rejects larger values", () => {
  assert.equal(resolveUserUsageRange({ days: "366" }, now).days, 366);
  assert.throws(
    () => resolveUserUsageRange({ days: "367" }, now),
    /between 1 and 366/,
  );
});
