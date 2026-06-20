import type { SpacePublicEndpoints } from "@cohub/protocol/ports";
import type { ChannelEnvelope } from "@cohub/protocol/realtime";

export function extractPublicEndpoints(value: unknown): SpacePublicEndpoints {
	if (!value || typeof value !== "object" || Array.isArray(value)) return {};
	const sandbox = (value as { sandbox?: unknown }).sandbox;
	if (!sandbox || typeof sandbox !== "object" || Array.isArray(sandbox)) {
		return {};
	}
	const endpoints = (sandbox as { publicEndpoints?: unknown }).publicEndpoints;
	if (!endpoints || typeof endpoints !== "object" || Array.isArray(endpoints)) {
		return {};
	}
	return endpoints as SpacePublicEndpoints;
}

export function isHttpUrl(url: string) {
	try {
		const parsed = new URL(url);
		return parsed.protocol === "http:" || parsed.protocol === "https:";
	} catch {
		return false;
	}
}

export function applyPortsChangedToEndpoints(
	currentEndpoints: SpacePublicEndpoints,
	payload: ChannelEnvelope,
): { endpoints: SpacePublicEndpoints; changedPorts: string[] } {
	const eventPayload = payload.payload as {
		ports?: Array<{
			port?: number;
			status?: "listening" | "closed";
			observedAt?: number;
		}>;
	};
	const endpoints: SpacePublicEndpoints = { ...currentEndpoints };
	const changedPorts: string[] = [];
	for (const item of eventPayload.ports ?? []) {
		if (!item.port || !item.status) continue;
		const key = String(item.port);
		const current = endpoints[key];
		if (!current) continue;
		endpoints[key] = {
			...current,
			status: item.status,
			observedAt: item.observedAt,
		};
		changedPorts.push(key);
	}
	return { endpoints, changedPorts };
}
