/** Per-model availability status, derived from periodic probe results. */

export type ModelAvailabilityStatus = "operational" | "degraded" | "outage";

/**
 * Aggregated availability for a single model.
 * All rate fields are percentages (0–100); `null` means no samples in that window.
 */
export type ModelStatusEntry = {
	status: ModelAvailabilityStatus;
	/** 5-minute window success rate — drives the selector dot color. */
	successRate5m: number | null;
	successRate2h: number | null;
	successRate24h: number | null;
	/** 1-hour average / P90 response duration in milliseconds. */
	latencyAvgMs: number | null;
	latencyP90Ms: number | null;
	samples1h: number | null;
	checkedAt: string | null;
	probeIntervalSeconds: number | null;
	/** 24-hour history in 15-minute buckets (oldest → newest), or null. */
	history: Array<{
		t: string;
		status: ModelAvailabilityStatus;
		rate: number | null;
		samples: number;
	}> | null;
};

export type ModelStatusResponse = {
	generatedAt: string;
	overallStatus: ModelAvailabilityStatus | "unknown";
	/** Keyed by model id. */
	models: Record<string, ModelStatusEntry>;
};
