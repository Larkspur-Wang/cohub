import type { ModelStatusEntry, ModelAvailabilityStatus } from "@cohub/protocol/model/status";

/**
 * Selector dot color levels. Derived from the 5-minute probe window so the
 * indicator reflects current availability, not long-term history.
 *
 * - `available` (green): ≥95% success, OR no probe data (new models default
 *   to available — probe coverage lags behind new catalog entries).
 * - `degraded` (amber): 75–95%.
 * - `outage` (red): <75%.
 */
export type AvailabilityLevel = "available" | "degraded" | "outage";

const AVAILABLE_THRESHOLD = 95;
const DEGRADED_THRESHOLD = 75;

export function availabilityLevel(
	entry: ModelStatusEntry | null | undefined,
): AvailabilityLevel {
	if (!entry) return "available";
	const rate = entry.successRate5m;
	if (rate == null) return "available"; // no recent samples → green fallback
	if (rate >= AVAILABLE_THRESHOLD) return "available";
	if (rate >= DEGRADED_THRESHOLD) return "degraded";
	return "outage";
}

export const AVAILABILITY_LABEL: Record<AvailabilityLevel, string> = {
	available: "Operational",
	degraded: "Degraded",
	outage: "Outage",
};

/** Map a probe status to the same 3-level scale, used by the hover card header. */
export function statusToLevel(
	status: ModelAvailabilityStatus,
): AvailabilityLevel {
	if (status === "operational") return "available";
	if (status === "degraded") return "degraded";
	return "outage";
}
