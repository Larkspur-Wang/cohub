import type { SpaceRecord, UserProfile } from "@neta-art/cohub";

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
