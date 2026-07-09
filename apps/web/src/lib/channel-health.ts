import type {
	ChannelHealth,
	ChannelRuntimeState,
} from "@cohub/protocol/gateway/types";

export function channelHealthLabel(
	health: ChannelHealth | null | undefined,
	options?: { bound?: boolean },
): string {
	if (!health) {
		return options?.bound ? "Connecting" : "Not bound";
	}
	switch (health.state) {
		case "ready":
			return "Ready";
		case "connecting":
			return "Connecting";
		case "degraded":
			return "Degraded";
		case "error":
			return "Error";
		case "stopped":
			return "Stopped";
		case "unbound":
			return "Not bound";
		default:
			return "Unknown";
	}
}

export function channelHealthClass(
	state: ChannelRuntimeState | null | undefined,
): string {
	switch (state) {
		case "ready":
			return "bg-success-bg text-success-soft ring-success-soft/25";
		case "connecting":
			return "bg-warning-bg text-warning-soft ring-warning-soft/25";
		case "degraded":
			return "bg-warning-bg text-warning-soft ring-warning-soft/25";
		case "error":
			return "bg-error-bg text-error-soft ring-error-soft/25";
		case "stopped":
		case "unbound":
			return "bg-bg-hover text-text-tertiary ring-border-subtle";
		default:
			return "bg-bg-hover text-text-tertiary ring-border-subtle";
	}
}

export function channelHealthMessage(
	health: ChannelHealth | null | undefined,
): string | null {
	if (!health) return null;
	if (
		health.state === "ready" ||
		health.state === "connecting" ||
		health.state === "stopped" ||
		health.state === "unbound"
	) {
		return null;
	}
	return health.message?.trim() || health.detail?.trim() || null;
}

export function channelHealthDetail(
	health: ChannelHealth | null | undefined,
): string | null {
	if (!health) return null;
	if (health.state === "ready" || health.state === "connecting") return null;
	const detail = health.detail?.trim();
	const message = health.message?.trim();
	if (detail && detail !== message) return detail;
	return null;
}
