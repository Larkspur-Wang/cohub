import type { Usage } from "@cohub/protocol/core";
import { formatUsageCost, getUsageCostTotal } from "$lib/format-usage";

export type GenerationCostPresentation = {
	label: string;
	detail: string;
};

function asRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function formattedCost(value: unknown) {
	return typeof value === "number" && Number.isFinite(value)
		? formatUsageCost(value)
		: "";
}

function readableReason(value: unknown) {
	return typeof value === "string" ? value.replaceAll("_", " ") : "";
}

export function getGenerationCostPresentation(input: {
	usage?: Usage | null;
	generation?: unknown;
}): GenerationCostPresentation | null {
	const generation = asRecord(input.generation);
	const billing = asRecord(generation?.billing);
	const status = billing?.status;
	const reason = billing?.reason;
	const charged = formattedCost(billing?.amountUsd);
	const providerCost = formattedCost(generation?.officialCostUsd);
	const providerDetail = providerCost ? `Provider cost: ${providerCost}` : "";

	if ((status === "recorded" || status === "overage") && charged) {
		return {
			label: charged,
			detail: [`Charged: ${charged}`, providerDetail]
				.filter(Boolean)
				.join("  ·  "),
		};
	}
	if (status === "skipped" && reason === "record_failed" && charged) {
		return {
			label: `${charged} pending`,
			detail: [
				`Pending charge: ${charged}`,
				providerDetail,
				"Billing retry scheduled",
			]
				.filter(Boolean)
				.join("  ·  "),
		};
	}
	if (status === "skipped" && providerCost) {
		const reasonText = readableReason(reason);
		return {
			label: `${providerCost} not charged`,
			detail: [
				"Not charged",
				providerDetail,
				reasonText ? `Reason: ${reasonText}` : "",
			]
				.filter(Boolean)
				.join("  ·  "),
		};
	}
	if (providerCost) {
		return { label: providerCost, detail: providerDetail };
	}

	const legacyCost = getUsageCostTotal(input.usage);
	if (legacyCost == null) return null;
	const label = formatUsageCost(legacyCost);
	return label ? { label, detail: `Cost: ${label}` } : null;
}
