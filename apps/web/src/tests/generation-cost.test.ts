import assert from "node:assert/strict";
import test from "node:test";
import { getGenerationCostPresentation } from "$lib/generation-cost";

const generation = (billing: Record<string, unknown>) => ({
	officialCostUsd: 0.02,
	billing,
});

test("shows recorded generation billing as charged", () => {
	assert.deepEqual(
		getGenerationCostPresentation({
			usage: { cost: { total: 0.01 } },
			generation: generation({ status: "recorded", amountUsd: 0.01 }),
		}),
		{
			label: "$0.010",
			detail: "Charged: $0.010  ·  Provider cost: $0.020",
		},
	);
});

test("shows failed billing records as pending instead of charged", () => {
	assert.deepEqual(
		getGenerationCostPresentation({
			generation: generation({
				status: "skipped",
				reason: "record_failed",
				amountUsd: 0.01,
			}),
		}),
		{
			label: "$0.010 pending",
			detail:
				"Pending charge: $0.010  ·  Provider cost: $0.020  ·  Billing retry scheduled",
		},
	);
});

test("shows skipped generation billing as not charged", () => {
	assert.deepEqual(
		getGenerationCostPresentation({
			generation: generation({
				status: "skipped",
				reason: "billing_not_configured",
				amountUsd: 0.01,
			}),
		}),
		{
			label: "$0.020 not charged",
			detail:
				"Not charged  ·  Provider cost: $0.020  ·  Reason: billing not configured",
		},
	);
});
