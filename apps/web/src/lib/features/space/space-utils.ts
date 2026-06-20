import type { SpaceRecord, UserProfile } from "@neta-art/cohub";
import type { SpaceSandboxSnapshot } from "./modules/space-status-controller.svelte";

export function formatDateTime(dateStr: string | null | undefined): string {
	if (!dateStr) return "—";
	const d = new Date(dateStr);
	return d.toLocaleString("en-US", {
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
	});
}

export function formatShortDateTime(
	dateStr: string | null | undefined,
): string {
	if (!dateStr) return "—";
	const d = new Date(dateStr);
	return d.toLocaleString("en-US", {
		month: "short",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	});
}

export function asRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

export function fallbackUserName(userUuid: string | null | undefined): string {
	if (!userUuid) return "Unknown user";
	const compact = userUuid.replaceAll("-", "");
	return compact.slice(0, 8) || "User";
}

export function displayUserName(
	profile: UserProfile | null | undefined,
	userUuid: string | null | undefined,
): string {
	return profile?.displayName?.trim() || fallbackUserName(userUuid);
}

export function displayOwnerHandle(
	profile: UserProfile | null | undefined,
): string | null {
	const username = profile?.username?.trim();
	return username ? `@${username}` : null;
}

export function formatFileSize(bytes: number): string {
	if (bytes === 0) return "0 B";
	const units = ["B", "KB", "MB", "GB"];
	const i = Math.floor(Math.log(bytes) / Math.log(1024));
	const value = bytes / 1024 ** i;
	return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[i]}`;
}

export function formatTokenCount(n: number): string {
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
	if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
	return String(n);
}

export function formatUsageCost(n: number): string {
	if (n <= 0) return "$0";
	if (n < 0.01) return "<$0.01";
	return `${n.toFixed(2)}`;
}

export function getSpaceOwnerUsername(record: SpaceRecord | null): string {
	return record?.ownerProfile?.username?.trim() ?? "";
}

export function getSpaceSlug(record: SpaceRecord | null): string {
	return record?.slug?.trim() ?? "";
}

export function getSpacePublicPath(record: SpaceRecord | null): string {
	const username = getSpaceOwnerUsername(record);
	const slug = getSpaceSlug(record);
	return username && slug ? `/${username}/${slug}` : "";
}

export function getSpacePrettyUrlHint(record: SpaceRecord | null): string {
	const hasUsername = Boolean(getSpaceOwnerUsername(record));
	const hasSlug = Boolean(getSpaceSlug(record));
	if (hasUsername && hasSlug) return "";
	if (!hasUsername && !hasSlug)
		return "Add a space slug and username for a cleaner URL.";
	if (!hasUsername)
		return "Add username in Profile to complete the pretty URL.";
	return "Add a space slug for a cleaner URL.";
}

export function formatCompactId(id: string): string {
	if (!id) return "";
	if (id.length <= 13) return id;
	return `${id.slice(0, 8)}…${id.slice(-4)}`;
}

export function sandboxStatusKind(
	sandbox: SpaceSandboxSnapshot | null,
): "running" | "waking" | "sleeping" | "error" | "unknown" {
	const status = sandbox?.status;
	const runtime = sandbox?.runtimeStatus;
	if (!sandbox) return "unknown";
	if (
		status === "error" ||
		status === "terminated" ||
		runtime === "unhealthy"
	) {
		return "error";
	}
	if (status === "stopped" || status === "stopping") return "sleeping";
	if (
		status === "provisioning" ||
		status === "pending" ||
		runtime === "starting"
	) {
		return "waking";
	}
	if (
		status === "running" ||
		status === "ready" ||
		runtime === "healthy" ||
		runtime === "degraded"
	) {
		return "running";
	}
	return "unknown";
}

export function sandboxStatusLabel(
	sandbox: SpaceSandboxSnapshot | null,
): string {
	const kind = sandboxStatusKind(sandbox);
	if (kind === "running") return "Sandbox running";
	if (kind === "waking") return "Sandbox waking";
	if (kind === "sleeping") return "Sandbox sleeping";
	if (kind === "error") return "Sandbox needs attention";
	return "Sandbox status unknown";
}

export function formatBootstrapStage(stage: string | null) {
	if (!stage) return "Waiting";
	if (stage === "prepare") return "Preparing workspace";
	if (stage === "import") return "Importing repository";
	if (stage === "checkpoint_restore") return "Restoring save";
	if (stage === "push") return "Pushing initial state";
	if (stage === "finalize") return "Finalizing";
	return stage.replace(/_/g, " ");
}

export function formatBootstrapStatus(status: string | null) {
	if (!status) return "Pending";
	if (status === "running") return "Running";
	if (status === "ready") return "Ready";
	if (status === "failed") return "Failed";
	return "Pending";
}
