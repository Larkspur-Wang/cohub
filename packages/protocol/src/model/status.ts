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
	/**
	 * 8-hour heartbeat rates in 2-minute buckets (oldest → newest), or null.
	 * Parallel to `heartbeats8hStart`. Drives the fine-grained hover card
	 * bar chart, matching router-status.neta.art's 8h/2min visualization.
	 */
	heartbeats8h: number[] | null;
};

export type ModelStatusResponse = {
	generatedAt: string;
	overallStatus: ModelAvailabilityStatus | "unknown";
	/** Start of the 8h heartbeat window (ISO). Buckets are 2 minutes apart. */
	heartbeats8hStart: string | null;
	/** Keyed by model id. */
	models: Record<string, ModelStatusEntry>;
};
