import type {
	SpaceMember,
	SpaceRecord,
	SpaceUsageResponse,
} from "@neta-art/cohub";
import { sdk } from "$lib/sdk";
import {
	fetchSpaceMembersWithCache,
	fetchSpaceUsageWithCache,
	getCachedSpaceMembers,
	getCachedSpaceUsage,
} from "$lib/stores/space-profile-cache";

export type SpaceSandboxSnapshot = {
	status: string | null;
	runtimeStatus?: string | null;
	lastHeartbeatAt?: string | null;
	lastActivityAt?: string | null;
	stoppedAt?: string | null;
	stopReason?: string | null;
};

export type BootstrapStatus = "pending" | "running" | "ready" | "failed" | null;

function readBootstrapStatus(space: SpaceRecord): string | null {
	const raw = space.meta;
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
	const bootstrap = (raw as Record<string, unknown>).bootstrap;
	if (!bootstrap || typeof bootstrap !== "object" || Array.isArray(bootstrap)) {
		return null;
	}
	const status = (bootstrap as Record<string, unknown>).status;
	return typeof status === "string" ? status : null;
}

export function createSpaceStatusController(options: {
	getSpaceId: () => string;
	getBootstrapStatus: () => BootstrapStatus;
	getPageVisible: () => boolean;
	getPageOnline: () => boolean;
	getPageMounted: () => boolean;
	onSpaceLoaded: (space: SpaceRecord) => void;
}) {
	let loadError = $state("");
	let members = $state<SpaceMember[]>([]);
	let membersLoadedFor = $state<string | null>(null);
	let usage = $state<SpaceUsageResponse | null>(null);
	let usageLoadedFor = $state<string | null>(null);
	let sandbox = $state<SpaceSandboxSnapshot | null>(null);
	let sandboxLoadedFor = $state<string | null>(null);
	let notice = $state("");
	let noticeTimer: ReturnType<typeof setTimeout> | null = null;
	let refreshTimer: ReturnType<typeof setTimeout> | null = null;
	let refreshInFlight = false;

	function clearNoticeTimer() {
		if (!noticeTimer) return;
		clearTimeout(noticeTimer);
		noticeTimer = null;
	}

	function showNotice(message: string) {
		notice = message;
		clearNoticeTimer();
		noticeTimer = setTimeout(() => {
			notice = "";
			noticeTimer = null;
		}, 2800);
	}

	async function loadSpace() {
		const currentSpaceId = options.getSpaceId();
		loadError = "";
		try {
			const nextSpace = await sdk.space(currentSpaceId).get();
			if (options.getSpaceId() !== currentSpaceId) return false;
			options.onSpaceLoaded(nextSpace);
			return true;
		} catch (error) {
			if (options.getSpaceId() !== currentSpaceId) return false;
			loadError =
				error instanceof Error ? error.message : "Failed to load space";
			return false;
		}
	}

	async function loadMembers(currentSpaceId = options.getSpaceId()) {
		const cached = getCachedSpaceMembers(currentSpaceId);
		if (cached && options.getSpaceId() === currentSpaceId) {
			members = cached;
			membersLoadedFor = currentSpaceId;
		}
		try {
			const nextMembers = await fetchSpaceMembersWithCache(currentSpaceId);
			if (options.getSpaceId() !== currentSpaceId) return;
			members = nextMembers;
			membersLoadedFor = currentSpaceId;
		} catch {
			if (options.getSpaceId() !== currentSpaceId) return;
			if (!cached) members = [];
			membersLoadedFor = currentSpaceId;
		}
	}

	async function loadUsage(currentSpaceId = options.getSpaceId()) {
		const days = 7;
		const cached = getCachedSpaceUsage(currentSpaceId, days);
		if (cached && options.getSpaceId() === currentSpaceId) {
			usage = cached;
			usageLoadedFor = currentSpaceId;
		}
		try {
			const result = await fetchSpaceUsageWithCache(currentSpaceId, days);
			if (options.getSpaceId() !== currentSpaceId) return;
			usage = result;
			usageLoadedFor = currentSpaceId;
		} catch {
			if (options.getSpaceId() !== currentSpaceId) return;
			if (!cached) usage = null;
			usageLoadedFor = currentSpaceId;
		}
	}

	async function loadSandbox(currentSpaceId = options.getSpaceId()) {
		try {
			const result = await sdk.space(currentSpaceId).sandbox.get();
			if (options.getSpaceId() !== currentSpaceId) return;
			sandbox = result.sandbox;
			sandboxLoadedFor = currentSpaceId;
		} catch {
			if (options.getSpaceId() !== currentSpaceId) return;
			sandbox = null;
			sandboxLoadedFor = currentSpaceId;
		}
	}

	function getRefreshIntervalMs() {
		if (!options.getPageVisible() || !options.getPageOnline()) return null;
		const status = options.getBootstrapStatus();
		if (status === "pending" || status === "running") return 4000;
		if (status === "failed") return 15000;
		return null;
	}

	async function refreshStatus() {
		if (refreshInFlight) return;
		refreshInFlight = true;
		try {
			const previousBootstrapStatus = options.getBootstrapStatus();
			const nextSpace = await sdk.space(options.getSpaceId()).get();
			options.onSpaceLoaded(nextSpace);
			if (
				previousBootstrapStatus !== "ready" &&
				readBootstrapStatus(nextSpace) === "ready"
			) {
				showNotice("Workspace prepared");
			}
		} finally {
			refreshInFlight = false;
		}
	}

	function scheduleRefresh() {
		if (refreshTimer) {
			clearTimeout(refreshTimer);
			refreshTimer = null;
		}
		const intervalMs = getRefreshIntervalMs();
		if (!intervalMs || !options.getPageMounted()) return;
		refreshTimer = setTimeout(async () => {
			await refreshStatus().catch(() => undefined);
			scheduleRefresh();
		}, intervalMs);
	}

	function reset() {
		if (refreshTimer) clearTimeout(refreshTimer);
		refreshTimer = null;
		loadError = "";
		members = [];
		membersLoadedFor = null;
		usage = null;
		usageLoadedFor = null;
		sandbox = null;
		sandboxLoadedFor = null;
		notice = "";
		clearNoticeTimer();
	}

	function dispose() {
		clearNoticeTimer();
		if (refreshTimer) clearTimeout(refreshTimer);
		refreshTimer = null;
	}

	return {
		get loadError() {
			return loadError;
		},
		get members() {
			return members;
		},
		get membersLoadedFor() {
			return membersLoadedFor;
		},
		get usage() {
			return usage;
		},
		get usageLoadedFor() {
			return usageLoadedFor;
		},
		get sandbox() {
			return sandbox;
		},
		get sandboxLoadedFor() {
			return sandboxLoadedFor;
		},
		get notice() {
			return notice;
		},
		loadSpace,
		loadMembers,
		loadUsage,
		loadSandbox,
		showNotice,
		refreshStatus,
		scheduleRefresh,
		reset,
		dispose,
	};
}
