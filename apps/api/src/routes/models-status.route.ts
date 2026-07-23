import { createLogger } from "@cohub/infra/logging";
import { Hono } from "hono";
import type {
  ModelAvailabilityStatus,
  ModelStatusEntry,
  ModelStatusResponse,
} from "@cohub/protocol/model/status";
import { config } from "../config.js";
import { useAuth } from "../lib/middleware.js";
import { redisCommandClient } from "../redis.js";

const logger = createLogger({ serviceName: "cohub-api" });

/**
 * Redis-cached, slimmed view of per-model availability derived from the
 * router-status probe service. The upstream payload (~870KB) carries raw
 * per-probe samples we don't need; we cache only the aggregated fields the
 * UI consumes (~10–15KB). TTL matches the probe cadence so freshness is
 * never worse than fetching directly.
 */
const STATUS_REDIS_KEY = "configs:models-status:v1";
const STATUS_CACHE_TTL_SEC = 30;
/** Primary probe instance; others are fallbacks per model id. */
const PRIMARY_INSTANCE = "neta";

let inflightPromise: Promise<ModelStatusResponse> | null = null;

type RawCheck = {
	model: string;
	instance?: string;
	status: string;
	checked_at?: string;
	probe_interval_seconds?: number;
	latency_1h?: {
		sample_count?: number;
		average_duration_ms?: number;
		p90_duration_ms?: number;
	};
	windows?: Record<
		string,
		{
			sample_count?: number;
			operational_samples?: number;
			outage_samples?: number;
			success_rate?: number;
		}
	>;
	history?: Array<{
		started_at?: string;
		status?: string;
		sample_count?: number;
		operational_samples?: number;
	}>;
};

type RawOnlineHeartbeat = {
	start?: string;
	success_rate?: number;
};

type RawOnlineModel = {
	model: string;
	heartbeats?: RawOnlineHeartbeat[];
};

type RawOnline = {
	window?: { start?: string; minutes?: number };
	models?: RawOnlineModel[];
};

type RawStatus = {
	generated_at?: string;
	overall_status?: string;
	checks?: RawCheck[];
	online?: RawOnline;
};

function normalizeStatus(value: string | undefined): ModelAvailabilityStatus {
	if (value === "operational" || value === "degraded" || value === "outage") return value;
	return "operational";
}

function windowRate(
	windows: RawCheck["windows"],
	key: string,
): number | null {
	const w = windows?.[key];
	if (!w?.sample_count) return null;
	return typeof w.success_rate === "number" ? w.success_rate : null;
}

/** 24h uptime from history buckets; null if no usable samples. */
function uptime24h(history: RawCheck["history"]): number | null {
	if (!history?.length) return null;
	let op = 0;
	let total = 0;
	for (const b of history) {
		const sc = b.sample_count ?? 0;
		total += sc;
		op += b.operational_samples ?? 0;
	}
	return total > 0 ? (op / total) * 100 : null;
}

function slimCheck(c: RawCheck, heartbeats8h: number[] | null): ModelStatusEntry {
	const windows = c.windows ?? {};
	const l = c.latency_1h;
	return {
		status: normalizeStatus(c.status),
		successRate5m: windowRate(windows, "5m"),
		successRate2h: windowRate(windows, "2h"),
		successRate24h: uptime24h(c.history),
		latencyAvgMs: l?.average_duration_ms ?? null,
		latencyP90Ms: l?.p90_duration_ms ?? null,
		samples1h: l?.sample_count ?? null,
		checkedAt: c.checked_at ?? null,
		probeIntervalSeconds: c.probe_interval_seconds ?? null,
		heartbeats8h,
		history: c.history?.length
			? c.history.map((b) => ({
					t: b.started_at ?? "",
					status: normalizeStatus(b.status),
					rate: b.sample_count ? ((b.operational_samples ?? 0) / b.sample_count) * 100 : null,
					samples: b.sample_count ?? 0,
				}))
			: null,
	};
}

async function fetchUpstream(): Promise<ModelStatusResponse> {
	const res = await fetch(config.routerStatusUrl, {
		headers: { accept: "application/json" },
	});
	if (!res.ok) {
		throw new Error(`router-status upstream returned ${res.status}`);
	}
	const raw = (await res.json()) as RawStatus;

	// Primary instance wins; fallbacks only fill gaps per model id.
	const byModel = new Map<string, RawCheck>();
	for (const c of raw.checks ?? []) {
		const existing = byModel.get(c.model);
		if (!existing || (c.instance === PRIMARY_INSTANCE && existing.instance !== PRIMARY_INSTANCE)) {
			byModel.set(c.model, c);
		}
	}

	// 8h/2min heartbeats from the online section (fine-grained bar chart data).
	const onlineModels = raw.online?.models ?? [];
	const heartbeatsByModel = new Map<string, number[]>();
	for (const m of onlineModels) {
		if (!m.heartbeats?.length) continue;
		heartbeatsByModel.set(
			m.model,
			m.heartbeats.map((hb) =>
				typeof hb.success_rate === "number" ? Math.round(hb.success_rate * 10) / 10 : 0,
			),
		);
	}
	const heartbeats8hStart = raw.online?.window?.start ?? null;

	const models: Record<string, ModelStatusEntry> = {};
	for (const [id, c] of byModel)
		models[id] = slimCheck(c, heartbeatsByModel.get(id) ?? null);

	const overall = raw.overall_status;
	const response: ModelStatusResponse = {
		generatedAt: raw.generated_at ?? new Date().toISOString(),
		overallStatus:
			overall === "operational" || overall === "degraded" || overall === "outage"
				? overall
				: "unknown",
		heartbeats8hStart,
		models,
	};

	await redisCommandClient.set(
		STATUS_REDIS_KEY,
		JSON.stringify(response),
		"EX",
		STATUS_CACHE_TTL_SEC,
	);
	return response;
}

async function loadStatus(): Promise<ModelStatusResponse> {
	if (inflightPromise) return inflightPromise;

	const promise = (async () => {
		const cached = await redisCommandClient.get(STATUS_REDIS_KEY);
		if (cached) {
			try {
				return JSON.parse(cached) as ModelStatusResponse;
			} catch {
				// fall through to upstream
			}
		}
		return fetchUpstream();
	})();

	inflightPromise = promise;
	try {
		return await promise;
	} finally {
		if (inflightPromise === promise) inflightPromise = null;
	}
}

const router = new Hono();

router.get("/", async (c) => {
	const user = useAuth(c);
	if (user instanceof Response) return user;

	try {
		return c.json(await loadStatus());
	} catch (error) {
		logger.error("[models-status] failed to load", error);
		return c.json({ message: "failed to load model status" }, 502);
	}
});

export default router;
