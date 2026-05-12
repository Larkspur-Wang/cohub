<script lang="ts">
import type {
	CheckpointRecord,
	CronJobRecord,
	SessionRecord,
	SpaceMarkListItem,
	SpaceRecord,
	TaskRunRecord,
} from "@neta-art/cohub";
import {
	Activity,
	ArrowLeft,
	BarChart3,
	Check,
	ChevronDown,
	Clock,
	Compass,
	FileText,
	FolderKanban,
	History,
	KeyRound,
	LayoutDashboard,
	Loader2,
	LogOut,
	Network,
	NotebookPen,
	Pencil,
	Pin,
	PinOff,
	Plus,
	Search,
	Settings,
	Trash2,
	User,
	Users,
	X,
} from "lucide-svelte";
import { onMount, tick, untrack } from "svelte";
import { goto } from "$app/navigation";
import { page } from "$app/state";
import { logtoClient } from "$lib/auth";
import { handleUnauthorizedError } from "$lib/auth-redirect";
import { clearAllIndexedDbCache } from "$lib/cache/clear";
import { getCacheUserKey } from "$lib/cache/keys";
import Dialog from "$lib/components/Dialog.svelte";
import { sdk } from "$lib/sdk";
import {
	buildSpaceCheckpointNewRoute,
	buildSpaceCheckpointRoute,
	buildSpaceCronjobNewRoute,
	buildSpaceCronjobRoute,
	buildSpaceDetailRoute,
	buildSpaceSessionRoute,
	buildSpaceTaskRoute,
} from "$lib/space-routes";
import { authStore } from "$lib/stores/auth.svelte";
import { insertComposerSnippet } from "$lib/stores/composer-insert";
import {
	clearRecentSpace,
	getRecentSpaces,
	setRecentSpace,
} from "$lib/stores/recent-space";
import {
	clearAllCachedSessionLists,
	getCachedSessionListSnapshot,
	onSessionListCacheUpdated,
	patchCachedSessionList,
	setCachedSessionList,
} from "$lib/stores/session-list-cache";
import { isStreaming, unreadTracker } from "$lib/stores/session-state.svelte";
import {
	clearAllCachedSpaceLists,
	fetchSpaceListWithCache,
	getCachedSpaceList,
	getCachedSpaceListMeta,
	onSpaceListCacheUpdated,
} from "$lib/stores/space-list-cache";
import {
	clearAllCachedSpacePins,
	fetchSpacePinsWithCache,
	getCachedSpacePins,
	onSpacePinsCacheUpdated,
} from "$lib/stores/space-marks-cache";
import { isSpacePin, toggleSpacePin } from "$lib/stores/space-pins";

const {
	isMobile = false,
	onClose,
	mode = "space",
}: {
	isMobile?: boolean;
	onClose?: () => void;
	mode?: "space" | "settings";
} = $props();

const SESSION_PAGE_SIZE = 20;

let isLoading = $state(true);
let loadError = $state("");
let showUserMenu = $state(false);
let showSpaceModal = $state(false);
let spaces = $state<SpaceRecord[]>([]);
let sessions = $state<SessionRecord[]>([]);
let checkpoints = $state<CheckpointRecord[]>([]);
let pinnedMarks = $state<SpaceMarkListItem[]>([]);
let loadingSessions = $state(false);
let loadingMoreSessions = $state(false);
let sessionsPageInfo = $state<{ hasMore: boolean; nextCursor: string | null }>({
	hasMore: false,
	nextCursor: null,
});
let exhaustedFallbackSessionCursor = $state<string | null>(null);
let loadingCheckpoints = $state(false);

let sessionsCollapsed = $state(false);
let checkpointsCollapsed = $state(false);
let cronjobsCollapsed = $state(false);
let tasksCollapsed = $state(false);
let creatingSession = $state(false);
let createSessionError = $state("");

// Session rename state
let renamingSessionId = $state<string | null>(null);
let renameTitleValue = $state("");
let renameSaving = $state(false);
let renameInputElement: HTMLInputElement | null = $state(null);

let cronjobs = $state<CronJobRecord[]>([]);
let tasks = $state<TaskRunRecord[]>([]);
let loadingCronjobs = $state(false);
let loadingTasks = $state(false);

const currentPath = $derived(page.url.pathname);
const activeSession = $derived.by(() => {
	const match = currentPath.match(/^\/spaces\/[^/]+\/sessions\/([^/]+)/);
	const activeSessionId = match?.[1] ?? null;
	return sessions.find((s) => s.id === activeSessionId) ?? null;
});
const activeCheckpointId = $derived.by(() => {
	const match = currentPath.match(/^\/spaces\/[^/]+\/checkpoints\/([^/]+)/);
	const id = match?.[1] ?? null;
	if (!id || id === "new") return null;
	return id;
});
const activeCheckpoint = $derived(
	checkpoints.find((checkpoint) => checkpoint.id === activeCheckpointId) ??
		null,
);

const activeCronjobId = $derived.by(() => {
	const match = currentPath.match(/^\/spaces\/[^/]+\/cronjobs\/([^/]+)/);
	const id = match?.[1] ?? null;
	if (!id || id === "new") return null;
	return id;
});
const activeCronjob = $derived(
	cronjobs.find((job) => job.id === activeCronjobId) ?? null,
);

const activeTaskId = $derived.by(() => {
	const match = currentPath.match(/^\/spaces\/[^/]+\/tasks\/([^/]+)/);
	return match?.[1] ?? null;
});

const currentSpaceId = $derived.by(() => {
	const match = currentPath.match(/^\/spaces\/([^/]+)/);
	const id = match?.[1] ?? null;
	if (id === "new") return null;
	return id;
});

const currentSpace = $derived(
	currentSpaceId ? (spaces.find((s) => s.id === currentSpaceId) ?? null) : null,
);

const recentSpaceIds = $derived.by(() => {
	if (!showSpaceModal) return [];
	const userUuid = authStore.userUuid;
	if (!userUuid) return [];
	return getRecentSpaces(userUuid).map((entry) => entry.spaceId);
});

const recentSpaces = $derived.by(() => {
	return recentSpaceIds
		.map((id) => spaces.find((space) => space.id === id))
		.filter((space): space is SpaceRecord => Boolean(space));
});

const otherSpaces = $derived.by(() => {
	const recentIds = new Set(recentSpaceIds);
	return spaces.filter((space) => !recentIds.has(space.id));
});

const userDisplayName = $derived(
	authStore.profile?.displayName?.trim() || "User",
);

const settingsTabs = [
	{ id: "profile", label: "Profile", icon: User, href: "/settings/profile" },
	{
		id: "ssh-keys",
		label: "SSH Keys",
		icon: KeyRound,
		href: "/settings/ssh-keys",
	},
	{
		id: "rules",
		label: "User Rules",
		icon: NotebookPen,
		href: "/settings/rules",
	},
	{
		id: "channels",
		label: "Channels",
		icon: Network,
		href: "/settings/channels",
	},
];

const settingsReturnTo = $derived.by(() => {
	const returnTo = page.url.searchParams.get("from");
	if (!returnTo) return "/";
	try {
		const decoded = decodeURIComponent(returnTo);
		if (!decoded.startsWith("/") || decoded.startsWith("//")) return "/";
		if (decoded.startsWith("/settings")) return "/";
		return decoded;
	} catch {
		return "/";
	}
});

const activeSettingsTab = $derived.by(() => {
	const tab = settingsTabs.find((tab) => currentPath.startsWith(tab.href));
	return tab?.id ?? null;
});

function sourceBadge(source: string | null): string {
	if (!source || source === "web") return "";
	const idx = source.indexOf(":");
	return idx > 0 ? source.slice(0, idx) : source;
}

function sourceTooltip(source: string | null): string {
	return source ?? "";
}

function displayStatus(space: SpaceRecord) {
	return space.status ?? "unknown";
}

function getFallbackSessionCursor(sessionList: SessionRecord[]) {
	return sessionList.at(-1)?.lastMessageAt ?? null;
}

function shouldShowLoadMoreSessions() {
	if (sessionsPageInfo.hasMore && sessionsPageInfo.nextCursor) return true;
	const fallbackCursor = getFallbackSessionCursor(sessions);
	return Boolean(
		sessions.length >= SESSION_PAGE_SIZE &&
			fallbackCursor &&
			fallbackCursor !== exhaustedFallbackSessionCursor,
	);
}

function statusColorClass(status: string): string {
	switch (status) {
		case "running":
			return "bg-status-running";
		case "starting":
			return "bg-status-starting";
		case "error":
		case "failed":
			return "bg-status-error";
		case "hibernated":
			return "bg-status-hibernated";
		case "hibernating":
			return "bg-status-hibernating";
		default:
			return "bg-status-unknown";
	}
}

async function loadSpaces(force = false) {
	await authStore.ensureLoaded();
	if (!authStore.isAuthenticated) {
		isLoading = false;
		// For unauthenticated users, try to fetch the space from the URL directly
		// so the sidebar can still show the current space and sessions.
		if (currentSpaceId && !currentSpace) {
			try {
				const space = await sdk.space(currentSpaceId).get();
				spaces = [space];
			} catch {
				spaces = [];
			}
		} else {
			spaces = [];
		}
		return;
	}

	loadError = "";

	if (!force) {
		const cached = getCachedSpaceList();
		if (cached && cached.length > 0) {
			spaces = cached;
		}
	}

	const hasVisibleSpaces = spaces.length > 0;
	if (!hasVisibleSpaces) {
		isLoading = true;
	}

	const cacheMeta = getCachedSpaceListMeta();
	const shouldFetch = force || !cacheMeta || cacheMeta.isStale;
	if (!shouldFetch) {
		isLoading = false;
		return;
	}

	try {
		spaces = await fetchSpaceListWithCache(
			async () => await sdk.spaces.list(),
			{ force },
		);
	} catch (error) {
		if (await handleUnauthorizedError(error)) {
			return;
		}
		loadError =
			error instanceof Error ? error.message : "Failed to load spaces";
	} finally {
		isLoading = false;
	}
}

async function loadSessionsForSpace(spaceId: string, force = false) {
	if (!force && loadingSessions) return;

	if (!force) {
		const cached = await getCachedSessionListSnapshot(spaceId);
		if (cached && cached.sessions.length > 0) {
			sessions = cached.sessions;
			sessionsPageInfo = cached.pageInfo;
		}
	}

	const shouldShowLoading = sessions.length === 0;
	if (shouldShowLoading) {
		loadingSessions = true;
	}

	const cachedSnapshot = await getCachedSessionListSnapshot(spaceId);
	const shouldFetch = force || !cachedSnapshot || cachedSnapshot.stale;
	if (!shouldFetch) {
		loadingSessions = false;
		return;
	}

	try {
		const result = await sdk.space(spaceId).sessions.list({
			limit: SESSION_PAGE_SIZE,
		});
		const nextSessions = result.sessions ?? [];
		const nextPageInfo = result.pageInfo ?? {
			hasMore: false,
			nextCursor: null,
		};
		sessions = await setCachedSessionList(spaceId, nextSessions, nextPageInfo);
		sessionsPageInfo = nextPageInfo;
	} catch (error) {
		console.warn("[sidebar] Failed to load sessions", { spaceId, error });
	} finally {
		loadingSessions = false;
	}
}

async function loadMoreSessionsForSpace(spaceId: string) {
	if (loadingMoreSessions) return;
	const cursor =
		sessionsPageInfo.nextCursor ?? getFallbackSessionCursor(sessions);
	if (!cursor || cursor === exhaustedFallbackSessionCursor) return;
	loadingMoreSessions = true;
	try {
		const result = await sdk.space(spaceId).sessions.list({
			limit: SESSION_PAGE_SIZE,
			cursor,
		});
		const moreSessions = result.sessions ?? [];
		const nextPageInfo = result.pageInfo ?? {
			hasMore: false,
			nextCursor: null,
		};
		sessions = await patchCachedSessionList(
			spaceId,
			(current) => [...current, ...moreSessions],
			nextPageInfo,
		);
		sessionsPageInfo = nextPageInfo;
		exhaustedFallbackSessionCursor =
			!nextPageInfo.hasMore && moreSessions.length === 0 ? cursor : null;
	} catch (error) {
		console.warn("[sidebar] Failed to load more sessions", { spaceId, error });
	} finally {
		loadingMoreSessions = false;
	}
}

async function loadPinsForSpace(spaceId: string, force = false) {
	if (!force) {
		const cached = getCachedSpacePins(spaceId);
		if (cached) pinnedMarks = cached;
	}
	try {
		const marks = await fetchSpacePinsWithCache(
			spaceId,
			async () => {
				const result = await sdk.space(spaceId).marks.list("pin");
				return result.marks ?? [];
			},
			{ force },
		);
		pinnedMarks = marks;
	} catch {
		if (!getCachedSpacePins(spaceId)) pinnedMarks = [];
	}
}

async function loadCheckpointsForSpace(spaceId: string, force = false) {
	if (!force && loadingCheckpoints) return;
	const shouldShowLoading = checkpoints.length === 0;
	if (shouldShowLoading) {
		loadingCheckpoints = true;
	}
	try {
		const result = await sdk.space(spaceId).checkpoints.list();
		checkpoints = result.checkpoints ?? [];
	} catch (error) {
		console.warn("[sidebar] Failed to load checkpoints", { spaceId, error });
	} finally {
		loadingCheckpoints = false;
	}
}

async function loadCronjobsForSpace(spaceId: string, force = false) {
	if (!force && loadingCronjobs) return;
	const shouldShowLoading = cronjobs.length === 0;
	if (shouldShowLoading) {
		loadingCronjobs = true;
	}
	try {
		const result = await sdk.cronJobs.list(spaceId);
		cronjobs = result.jobs ?? [];
	} catch (error) {
		console.warn("[sidebar] Failed to load cronjobs", { spaceId, error });
	} finally {
		loadingCronjobs = false;
	}
}

async function loadTasksForSpace(spaceId: string, force = false) {
	if (!force && loadingTasks) return;
	const shouldShowLoading = tasks.length === 0;
	if (shouldShowLoading) {
		loadingTasks = true;
	}
	try {
		const result = await sdk.tasks.list({ spaceId });
		tasks = result.runs ?? [];
	} catch (error) {
		console.warn("[sidebar] Failed to load tasks", { spaceId, error });
	} finally {
		loadingTasks = false;
	}
}

async function handleNavigate(
	href: string,
	options?: { keepSettingsReturn?: boolean },
) {
	onClose?.();
	if (options?.keepSettingsReturn && mode === "settings") {
		const target = new URL(href, page.url);
		const from = page.url.searchParams.get("from");
		if (from && !target.searchParams.has("from")) {
			target.searchParams.set("from", from);
		}
		await goto(target.pathname + target.search + target.hash);
		return;
	}
	await goto(href);
}

function openSettings() {
	const current = `${page.url.pathname}${page.url.search}${page.url.hash}`;
	const target = new URL("/settings/profile", page.url);
	if (!current.startsWith("/settings")) {
		target.searchParams.set("from", current);
	}
	showUserMenu = false;
	void handleNavigate(target.pathname + target.search + target.hash);
}

function returnFromSettings() {
	void handleNavigate(settingsReturnTo);
}

function openCommandPalette() {
	onClose?.();
	window.dispatchEvent(new CustomEvent("cohub:open-command-palette"));
}

async function handleNavigateToSpace(spaceId: string) {
	showSpaceModal = false;
	onClose?.();
	await goto(buildSpaceDetailRoute(spaceId));
}

async function handleNavigateToSession(sessionId: string) {
	onClose?.();
	const session = sessions.find((s) => s.id === sessionId);
	unreadTracker.markViewed(sessionId, session?.lastMessageId ?? null);
	if (!currentSpaceId) return;
	await goto(buildSpaceSessionRoute(currentSpaceId, sessionId));
}

async function handleNavigateToPinned(mark: SpaceMarkListItem) {
	onClose?.();
	if (mark.resourceType === "file" && currentSpaceId) {
		window.dispatchEvent(
			new CustomEvent("cohub:open-inline-file", {
				detail: { spaceId: currentSpaceId, path: mark.resourceRef },
			}),
		);
		return;
	}
	await goto(mark.href);
}

async function handleNavigateToCheckpoint(checkpointId: string) {
	onClose?.();
	if (!currentSpaceId) return;
	await goto(buildSpaceCheckpointRoute(currentSpaceId, checkpointId));
}

async function handleNavigateToNewCheckpoint() {
	onClose?.();
	if (!currentSpaceId) return;
	await goto(buildSpaceCheckpointNewRoute(currentSpaceId));
}

async function handleNavigateToCronjob(cronjobId: string) {
	onClose?.();
	if (!currentSpaceId) return;
	await goto(buildSpaceCronjobRoute(currentSpaceId, cronjobId));
}

async function handleNavigateToNewCronjob() {
	onClose?.();
	if (!currentSpaceId) return;
	await goto(buildSpaceCronjobNewRoute(currentSpaceId));
}

async function handleNavigateToTask(taskId: string) {
	onClose?.();
	if (!currentSpaceId) return;
	await goto(buildSpaceTaskRoute(currentSpaceId, taskId));
}

async function handleCreateNewSession() {
	if (!currentSpaceId || creatingSession) return;
	creatingSession = true;
	createSessionError = "";
	try {
		const result = await sdk
			.space(currentSpaceId)
			.sessions.create({ source: "web" });
		sessions = await patchCachedSessionList(currentSpaceId, (current) => [
			result.session,
			...current.filter((session) => session.id !== result.session.id),
		]);
		await handleNavigateToSession(result.session.id);
	} catch (error) {
		createSessionError =
			error instanceof Error ? error.message : "Failed to create session";
	} finally {
		creatingSession = false;
	}
}

function isPinned(
	resourceType: "session" | "checkpoint" | "file",
	resourceRef: string,
) {
	return isSpacePin(pinnedMarks, resourceType, resourceRef);
}

function insertPathReference(path: string) {
	insertComposerSnippet(` \`${path}\` `);
	onClose?.();
}

function togglePinResource(
	resourceType: "session" | "checkpoint" | "file",
	resourceRef: string,
	label?: string | null,
) {
	if (!currentSpaceId) return;
	void toggleSpacePin({
		spaceId: currentSpaceId,
		resourceType,
		resourceRef,
		label,
	}).then((marks) => {
		pinnedMarks = marks;
	});
}

function getPinnedIcon(resourceType: string) {
	if (resourceType === "session") return Activity;
	if (resourceType === "checkpoint") return History;
	return FileText;
}

function getPinnedFallbackTitle(mark: SpaceMarkListItem) {
	return mark.resource?.title ?? mark.label ?? mark.resourceRef;
}

function isPinnedMarkActive(mark: SpaceMarkListItem) {
	if (!currentSpaceId) return false;
	if (mark.resourceType === "session") {
		return (
			currentPath === buildSpaceSessionRoute(currentSpaceId, mark.resourceRef)
		);
	}
	if (mark.resourceType === "checkpoint") {
		return (
			currentPath ===
			buildSpaceCheckpointRoute(currentSpaceId, mark.resourceRef)
		);
	}
	return currentPath === mark.href;
}

// ── Session rename ──────────────────────────────────────────────────────

function startRenameSession(session: SessionRecord) {
	renamingSessionId = session.id;
	renameTitleValue = session.title ?? getSessionTitle(session, 0);
	void tick().then(() => {
		renameInputElement?.focus();
		renameInputElement?.select();
	});
}

function cancelRenameSession() {
	renamingSessionId = null;
	renameTitleValue = "";
}

async function submitRenameSession(session: SessionRecord) {
	if (renameSaving || !currentSpaceId) return;
	const trimmed = renameTitleValue.trim();
	if (!trimmed) {
		cancelRenameSession();
		return;
	}
	if (trimmed === (session.title ?? getSessionTitle(session, 0))) {
		cancelRenameSession();
		return;
	}
	renameSaving = true;
	try {
		await sdk.space(currentSpaceId).session(session.id).rename(trimmed);
		sessions = await patchCachedSessionList(currentSpaceId, (current) =>
			current.map((s) => (s.id === session.id ? { ...s, title: trimmed } : s)),
		);
	} catch {
		// Silently fail
	} finally {
		renameSaving = false;
		cancelRenameSession();
	}
}

function sessionIsStreaming(session: SessionRecord): boolean {
	return isStreaming(session);
}

function getSessionTitle(session: SessionRecord, _index: number) {
	const candidates = [session.title, session.latestMessageText];
	for (const candidate of candidates) {
		const normalized = candidate
			?.replace(/\s+/g, " ")
			.replace(/^[:\-\s]+/, "")
			.trim();
		if (normalized) return normalized.slice(0, 36);
	}
	return "New chat";
}

function getCheckpointTitle(checkpoint: CheckpointRecord): string {
	return checkpoint.description || checkpoint.commitHash.slice(0, 12);
}

async function handleLogout() {
	onClose?.();
	const commandPaletteRecentKey = `cohub:command-palette:recent:${encodeURIComponent(getCacheUserKey())}`;
	try {
		localStorage.removeItem(commandPaletteRecentKey);
	} catch {
		// Ignore storage cleanup failures during logout.
	}
	clearAllCachedSpaceLists();
	clearAllCachedSpacePins();
	await clearAllIndexedDbCache().catch((error) => {
		console.warn("[sidebar] Failed to clear IndexedDB cache", error);
	});
	const userUuid = authStore.userUuid;
	if (userUuid) clearRecentSpace(userUuid);
	try {
		await logtoClient.signOut(`${window.location.origin}/`);
	} catch (error) {
		console.error("[sidebar] Failed to sign out", error);
	}
}

onMount(() => {
	let offSpaceListCacheUpdated = () => {};
	let offSessionListCacheUpdated = () => {};
	let offSpacePinsCacheUpdated = () => {};
	if (mode === "space") {
		offSpaceListCacheUpdated = onSpaceListCacheUpdated(
			({ spaces: nextSpaces }) => {
				if (!authStore.isAuthenticated) return;
				spaces = nextSpaces;
			},
		);
		offSessionListCacheUpdated = onSessionListCacheUpdated(
			({ spaceId, sessions: nextSessions, pageInfo }) => {
				if (spaceId !== currentSpaceId) return;
				sessions = nextSessions;
				if (pageInfo) sessionsPageInfo = pageInfo;
				exhaustedFallbackSessionCursor = null;
			},
		);
		offSpacePinsCacheUpdated = onSpacePinsCacheUpdated(({ spaceId, marks }) => {
			if (spaceId !== currentSpaceId) return;
			pinnedMarks = marks;
		});
		void (async () => {
			await loadSpaces();

			window.addEventListener(
				"cohub:space-created",
				handleSpaceCreated as EventListener,
			);
			window.addEventListener(
				"cohub:checkpoints-updated",
				handleCheckpointsUpdated as EventListener,
			);
			window.addEventListener(
				"cohub:marks-updated",
				handleMarksUpdated as EventListener,
			);
		})();
	}

	function handleSpaceCreated() {
		void loadSpaces(true);
	}

	function handleCheckpointsUpdated(e: Event) {
		const custom = e as CustomEvent;
		if (custom.detail?.spaceId === currentSpaceId && currentSpaceId) {
			void loadCheckpointsForSpace(currentSpaceId, true);
		}
	}

	function handleMarksUpdated(e: Event) {
		const custom = e as CustomEvent;
		if (custom.detail?.spaceId === currentSpaceId && currentSpaceId) {
			void loadPinsForSpace(currentSpaceId, true);
		}
	}

	function handleClickOutside(e: MouseEvent) {
		const target = e.target as HTMLElement;
		if (!target.closest("[data-user-menu]")) {
			showUserMenu = false;
		}
		if (!target.closest("[data-space-switcher]")) {
			showSpaceModal = false;
		}
	}
	document.addEventListener("click", handleClickOutside);

	return () => {
		offSpaceListCacheUpdated();
		offSessionListCacheUpdated();
		offSpacePinsCacheUpdated();
		document.removeEventListener("click", handleClickOutside);
		if (mode === "space") {
			window.removeEventListener(
				"cohub:space-created",
				handleSpaceCreated as EventListener,
			);
			window.removeEventListener(
				"cohub:checkpoints-updated",
				handleCheckpointsUpdated as EventListener,
			);
			window.removeEventListener(
				"cohub:marks-updated",
				handleMarksUpdated as EventListener,
			);
		}
	};
});

// For unauthenticated users, load the space directly from the URL
// so the sidebar can show the current space even without a full spaces list.
$effect(() => {
	if (mode !== "space") return;
	const id = currentSpaceId;
	if (id) {
		untrack(async () => {
			const requestedSpaceId = id;
			await authStore.ensureLoaded();
			if (requestedSpaceId !== currentSpaceId) return;
			if (!authStore.isAuthenticated && !currentSpace) {
				try {
					const space = await sdk.space(requestedSpaceId).get();
					if (requestedSpaceId !== currentSpaceId) return;
					spaces = [space];
				} catch {
					if (requestedSpaceId !== currentSpaceId) return;
					spaces = [];
				}
			}
		});
	}
});

$effect(() => {
	if (mode !== "space") return;
	const id = currentSpaceId;
	if (id) {
		sessions = [];
		pinnedMarks = [];
		sessionsPageInfo = { hasMore: false, nextCursor: null };
		exhaustedFallbackSessionCursor = null;
		untrack(() => {
			void loadSessionsForSpace(id);
			void loadPinsForSpace(id);
			void loadCheckpointsForSpace(id, true);
			void loadCronjobsForSpace(id, true);
			void loadTasksForSpace(id, true);
		});
	} else {
		sessions = [];
		pinnedMarks = [];
		sessionsPageInfo = { hasMore: false, nextCursor: null };
		exhaustedFallbackSessionCursor = null;
		checkpoints = [];
		cronjobs = [];
		tasks = [];
	}
});

// Track the most recently visited space in localStorage
$effect(() => {
	if (mode !== "space") return;
	const userUuid = authStore.userUuid;
	if (!userUuid || !currentSpaceId) return;
	untrack(() => {
		const sessionId = activeSession?.id ?? null;
		setRecentSpace(userUuid, currentSpaceId, sessionId);
	});
});

// Close space modal on Escape
$effect(() => {
	if (!showSpaceModal) return;
	function handleKeydown(e: KeyboardEvent) {
		if (e.key === "Escape") {
			showSpaceModal = false;
		}
	}
	window.addEventListener("keydown", handleKeydown);
	return () => window.removeEventListener("keydown", handleKeydown);
});
</script>

<aside class="{isMobile ? 'h-full' : 'shrink-0 h-screen'} flex flex-col bg-bg-primary">
  <!-- Brand Header -->
  <div class="h-[48px] flex items-center justify-between gap-2 px-3 border-b border-border-subtle shrink-0">
    <a href="/" class="flex min-w-0 items-center gap-2 group" aria-label="Cohub">
      <div class="w-7 h-7 bg-[#FF3E00] rounded-[6px] flex items-center justify-center font-bold text-[11px] text-white group-hover:bg-brand-hover transition-colors shrink-0">
        C
      </div>
      <span class="font-semibold text-[13px] text-text-primary tracking-tight truncate">Cohub</span>
    </a>
    <button
      type="button"
      class="group/search flex h-7 shrink-0 items-center gap-1.5 rounded-[6px] border border-border-subtle bg-bg-primary px-2 text-[11px] text-text-tertiary transition-colors duration-100 hover:border-brand/35 hover:bg-bg-hover hover:text-text-primary"
      onclick={openCommandPalette}
      title="Search everywhere (⌘K / Ctrl K)"
      aria-label="Search everywhere"
    >
      <Search class="h-3.5 w-3.5 text-text-placeholder transition-colors group-hover/search:text-brand" />
      <span class="hidden xl:inline font-mono tracking-[0.02em]">⌘K</span>
    </button>
  </div>

  {#if mode === "space"}
    <!-- Space Switcher (Discord-style) -->
    <div class="px-2 py-1 shrink-0 border-b border-border-subtle">
      <button
        type="button"
        data-space-switcher
        class="w-full flex items-center gap-1.5 px-2 py-1.5 rounded-[5px] hover:bg-bg-hover transition-colors duration-100 cursor-pointer group"
        onclick={() => {
          showSpaceModal = !showSpaceModal;
          if (showSpaceModal) {
            void loadSpaces();
          }
        }}
      >
        {#if currentSpace}
          <span class="flex-1 text-[13px] font-medium text-text-primary truncate text-left">{currentSpace.name || currentSpace.title || currentSpace.id.slice(0, 12)}</span>
        {:else}
          <span class="flex-1 text-[13px] text-text-placeholder truncate text-left">Select a space</span>
        {/if}
        <ChevronDown class="w-3.5 h-3.5 text-text-tertiary shrink-0 transition-transform duration-150 group-hover:text-text-secondary" />
      </button>
    </div>

    <!-- Action Buttons -->
    {#if currentSpace}
      <div class="px-2 py-1.5 shrink-0 space-y-[2px]">
        <button
          type="button"
          class="flex w-full items-center gap-2 rounded-[7px] border border-[#FF3E00]/20 bg-[#FF3E00]/10 px-2 py-1.5 text-brand transition-colors duration-100 hover:bg-[#FF3E00]/15 disabled:cursor-not-allowed disabled:opacity-50"
          onclick={() => { void handleCreateNewSession(); }}
          disabled={creatingSession}
          title="New chat"
        >
          {#if creatingSession}
            <Loader2 class="w-3.5 h-3.5 animate-spin shrink-0" />
            <span class="text-[12px] font-medium">Creating…</span>
          {:else}
            <Plus class="w-3.5 h-3.5 shrink-0" />
            <span class="text-[12px] font-medium">New Chat</span>
          {/if}
        </button>
        <button
          type="button"
          class="flex items-center gap-2 w-full px-2 py-1.5 rounded-[5px] text-text-tertiary hover:text-text-primary hover:bg-bg-hover transition-colors duration-100 disabled:opacity-50"
          onclick={() => { void handleNavigate(buildSpaceDetailRoute(currentSpaceId!)); }}
          title="Space details"
        >
          <LayoutDashboard class="w-3.5 h-3.5 shrink-0" />
          <span class="text-[12px] font-medium">Detail</span>
        </button>
        <button
          type="button"
          class="flex items-center gap-2 w-full px-2 py-1.5 rounded-[5px] text-text-tertiary hover:text-text-primary hover:bg-bg-hover transition-colors duration-100 disabled:opacity-50"
          onclick={handleNavigateToNewCheckpoint}
          title="New save"
        >
          <History class="w-3.5 h-3.5 shrink-0" />
          <span class="text-[12px] font-medium">New Save</span>
        </button>
        {#if createSessionError}
          <div class="px-2 py-1 text-[11px] text-error-soft">{createSessionError}</div>
        {/if}
      </div>
    {/if}

    <!-- Sessions / Checkpoints -->
    {#if currentSpace}
      <div class="flex-1 overflow-y-auto px-1 pb-2 pt-1 min-h-0">
        {#if loadingSessions && sessions.length === 0 && loadingCheckpoints && checkpoints.length === 0}
          <div class="px-1 py-4 text-[12px] text-text-tertiary text-center flex items-center justify-center gap-2">
            <Loader2 class="w-3 h-3 animate-spin" />
            Loading...
          </div>
        {:else}
          {#if pinnedMarks.length > 0}
            <div class="mb-3">
              <div class="flex items-center gap-2 px-2 py-1.5 w-full text-left rounded-[6px]">
                <Pin class="w-3 h-3 text-text-tertiary shrink-0" />
                <span class="text-[11px] text-text-placeholder select-none">Pinned</span>
              </div>
              <div class="space-y-[2px] mt-1">
                {#each pinnedMarks as mark (mark.id)}
                  {@const Icon = getPinnedIcon(mark.resourceType)}
                  {@const isActivePinned = isPinnedMarkActive(mark)}
                  <button
                    type="button"
                    class="group/pinned relative flex items-center gap-2 w-full overflow-hidden px-2 py-1.5 pr-8 mx-[-2px] rounded-[6px] text-left text-[13px] transition-colors duration-100 {isActivePinned ? 'text-text-primary bg-bg-active font-medium' : 'text-text-tertiary hover:text-text-secondary hover:bg-bg-hover'}"
                    onclick={() => void handleNavigateToPinned(mark)}
                    title={mark.resource?.subtitle ?? mark.resourceRef}
                    aria-current={isActivePinned ? "page" : undefined}
                  >
                    <Icon class="w-3.5 h-3.5 shrink-0 {isActivePinned ? 'text-text-tertiary' : 'text-text-placeholder'}" />
                    <span class="truncate leading-tight flex-1">{getPinnedFallbackTitle(mark)}</span>
                    <span class={isMobile ? "hidden" : "absolute right-1 top-1/2 -translate-y-1/2 inline-flex opacity-0 pointer-events-none transition-opacity group-hover/pinned:opacity-100 group-hover/pinned:pointer-events-auto group-focus-within/pinned:opacity-100 group-focus-within/pinned:pointer-events-auto"}>
                      <span
                        role="button"
                        tabindex="0"
                        class="p-0.5 rounded text-text-tertiary hover:text-text-primary hover:bg-bg-hover-strong transition-colors"
                        title="Unpin"
                        onclick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          togglePinResource(mark.resourceType, mark.resourceRef, getPinnedFallbackTitle(mark));
                        }}
                        onkeydown={(e) => {
                          if (e.key !== 'Enter' && e.key !== ' ') return;
                          e.preventDefault();
                          e.stopPropagation();
                          togglePinResource(mark.resourceType, mark.resourceRef, getPinnedFallbackTitle(mark));
                        }}
                      >
                        <PinOff class="w-3.5 h-3.5" />
                      </span>
                    </span>
                  </button>
                {/each}
              </div>
            </div>
          {/if}
          <button
            type="button"
            class="flex items-center gap-2 px-2 py-1.5 w-full text-left hover:bg-bg-hover transition-colors duration-100 rounded-[6px]"
            onclick={() => { sessionsCollapsed = !sessionsCollapsed; }}
            title={sessionsCollapsed ? "Expand chats" : "Collapse chats"}
          >
            <ChevronDown class="w-3 h-3 text-text-tertiary shrink-0 transition-transform duration-150 {sessionsCollapsed ? 'rotate-180' : ''}" />
            <span class="text-[11px] text-text-placeholder select-none">Chats</span>
          </button>

          {#if !sessionsCollapsed}
            {#if sessions.length === 0}
              <div class="px-2 py-2 text-[12px] text-text-placeholder">No chats</div>
            {:else}
              <div class="space-y-[2px] mt-1">
                {#each sessions as session, index (session.id)}
                  {@const isActive = currentPath === buildSpaceSessionRoute(currentSpaceId!, session.id)}
                  {@const isRenaming = renamingSessionId === session.id}

                  {#if isRenaming}
                    <!-- Inline rename input -->
                    <div class="flex items-center gap-1 px-1.5 py-1 mx-[-2px] rounded-[6px] bg-bg-active">
                      <input
                        bind:this={renameInputElement}
                        bind:value={renameTitleValue}
                        type="text"
                        class="flex-1 min-w-0 bg-transparent text-[13px] text-text-primary outline-none leading-tight"
                        placeholder="Session name"
                        maxlength={80}
                        disabled={renameSaving}
                        onkeydown={(e) => {
                          if (e.key === "Enter" && !renameSaving) {
                            e.preventDefault();
                            void submitRenameSession(session);
                          }
                          if (e.key === "Escape" && !renameSaving) {
                            e.preventDefault();
                            cancelRenameSession();
                          }
                        }}
                      />
                      <button
                        type="button"
                        class="p-0.5 rounded text-status-running hover:bg-bg-hover transition-colors shrink-0"
                        disabled={renameSaving}
                        onclick={() => void submitRenameSession(session)}
                        title="Save"
                      >
                        <Check class="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        class="p-0.5 rounded text-text-tertiary hover:text-text-primary hover:bg-bg-hover transition-colors shrink-0"
                        disabled={renameSaving}
                        onclick={cancelRenameSession}
                        title="Cancel"
                      >
                        <X class="w-3.5 h-3.5" />
                      </button>
                    </div>
                  {:else}
                    <a
                      href={buildSpaceSessionRoute(currentSpaceId!, session.id)}
                      class="group/session relative flex items-center gap-1.5 overflow-hidden px-2 py-1.5 pr-20 mx-[-2px] rounded-[6px] text-[13px] transition-colors duration-100 {isActive ? 'text-text-primary bg-bg-active font-medium' : 'text-text-tertiary hover:text-text-secondary hover:bg-bg-hover'}"
                      style={isMobile ? "-webkit-touch-callout: none; user-select: none;" : undefined}
							onclick={(e) => { e.preventDefault(); handleNavigateToSession(session.id); }}
							draggable={!isMobile}
								ondragstart={(e) => {
									e.dataTransfer?.setData(
										"text/cohub-path",
										`/sessions/${session.id}.jsonl`,
									);
									if (e.dataTransfer) e.dataTransfer.effectAllowed = "copy";
								}}
                      title={sourceTooltip(session.source) || undefined}
                    >
                      <span class="truncate leading-tight flex-1">{getSessionTitle(session, index)}</span>
                      {#if sourceBadge(session.source)}
                        <span class="absolute right-2 top-1/2 -translate-y-1/2 px-1.5 py-px rounded-[3px] bg-bg-hover-strong text-[10px] font-medium leading-none text-text-tertiary {isMobile ? '' : 'group-hover/session:opacity-0 group-focus-within/session:opacity-0'}">
                          {sourceBadge(session.source)}
                        </span>
                      {/if}
                      {#if sessionIsStreaming(session)}
                        <div class="absolute right-3 top-1/2 -translate-y-1/2 w-[6px] h-[6px] rounded-full bg-status-running animate-pulse {isMobile ? '' : 'group-hover/session:opacity-0 group-focus-within/session:opacity-0'}" title="Streaming..."></div>
                      {:else if unreadTracker.isUnread(session, session.lastMessageId)}
                        <div class="absolute right-3 top-1/2 -translate-y-1/2 w-[7px] h-[7px] rounded-full bg-brand {isMobile ? '' : 'group-hover/session:opacity-0 group-focus-within/session:opacity-0'}" title="Unread"></div>
                      {/if}
                      <span class={isMobile ? "hidden" : "absolute right-1 top-1/2 -translate-y-1/2 inline-flex items-center gap-0.5 opacity-0 pointer-events-none transition-opacity group-hover/session:opacity-100 group-hover/session:pointer-events-auto group-focus-within/session:opacity-100 group-focus-within/session:pointer-events-auto"}>
                        <button
                          type="button"
                          class="p-0.5 rounded text-text-tertiary hover:text-text-primary hover:bg-bg-hover-strong transition-colors"
                          draggable="false"
                          title="Insert"
                          onclick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
								insertPathReference(`/sessions/${session.id}.jsonl`);
                          }}
                        >
                          <FileText class="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          class="p-0.5 rounded text-text-tertiary hover:text-text-primary hover:bg-bg-hover-strong transition-colors"
                          draggable="false"
                          title={isPinned("session", session.id) ? "Unpin chat" : "Pin chat"}
                          onclick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            togglePinResource("session", session.id, getSessionTitle(session, index));
                          }}
                        >
                          {#if isPinned("session", session.id)}
                            <PinOff class="w-3.5 h-3.5" />
                          {:else}
                            <Pin class="w-3.5 h-3.5" />
                          {/if}
                        </button>
                        <button
                          type="button"
                          class="p-0.5 rounded text-text-tertiary hover:text-text-primary hover:bg-bg-hover-strong transition-colors"
                          draggable="false"
                          title="Rename"
                          onclick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            startRenameSession(session);
                          }}
                        >
                          <Pencil class="w-3.5 h-3.5" />
                        </button>
                      </span>
                    </a>
                  {/if}
                {/each}
                {#if shouldShowLoadMoreSessions()}
                  <button
                    type="button"
                    class="mt-1 flex items-center justify-center gap-2 w-full px-2 py-1.5 rounded-[6px] text-[12px] text-text-tertiary hover:text-text-secondary hover:bg-bg-hover transition-colors duration-100 disabled:opacity-60"
                    disabled={loadingMoreSessions}
                    onclick={() => currentSpaceId && void loadMoreSessionsForSpace(currentSpaceId)}
                  >
                    {#if loadingMoreSessions}
                      <Loader2 class="w-3 h-3 animate-spin" />
                      Loading...
                    {:else}
                      Load more
                    {/if}
                  </button>
                {/if}
              </div>
            {/if}
          {:else if activeSession}
            {@const isRenamingActive = renamingSessionId === activeSession.id}
            {#if isRenamingActive}
              <div class="flex items-center gap-1 px-1.5 py-1 mx-[-2px] mt-1 rounded-[6px] bg-bg-active">
                <input
                  bind:this={renameInputElement}
                  bind:value={renameTitleValue}
                  type="text"
                  class="flex-1 min-w-0 bg-transparent text-[13px] text-text-primary outline-none leading-tight"
                  placeholder="Session name"
                  maxlength={80}
                  disabled={renameSaving}
                  onkeydown={(e) => {
                    if (e.key === "Enter" && !renameSaving) {
                      e.preventDefault();
                      void submitRenameSession(activeSession);
                    }
                    if (e.key === "Escape" && !renameSaving) {
                      e.preventDefault();
                      cancelRenameSession();
                    }
                  }}
                />
                <button
                  type="button"
                  class="p-0.5 rounded text-status-running hover:bg-bg-hover transition-colors shrink-0"
                  disabled={renameSaving}
                  onclick={() => void submitRenameSession(activeSession)}
                  title="Save"
                >
                  <Check class="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  class="p-0.5 rounded text-text-tertiary hover:text-text-primary hover:bg-bg-hover transition-colors shrink-0"
                  disabled={renameSaving}
                  onclick={cancelRenameSession}
                  title="Cancel"
                >
                  <X class="w-3.5 h-3.5" />
                </button>
              </div>
            {:else}
              <a
                href={buildSpaceSessionRoute(currentSpaceId!, activeSession.id)}
                class="group/session relative flex items-center gap-1.5 overflow-hidden px-2 py-1.5 pr-20 mx-[-2px] mt-1 rounded-[6px] text-[13px] transition-colors duration-100 text-text-primary bg-bg-active font-medium"
                style={isMobile ? "-webkit-touch-callout: none; user-select: none;" : undefined}
				onclick={(e) => { e.preventDefault(); handleNavigateToSession(activeSession.id); }}
				draggable={!isMobile}
				ondragstart={(e) => {
					e.dataTransfer?.setData(
						"text/cohub-path",
						`/sessions/${activeSession.id}.jsonl`,
					);
					if (e.dataTransfer) e.dataTransfer.effectAllowed = "copy";
				}}
                title={sourceTooltip(activeSession.source) || undefined}
              >
                <span class="truncate leading-tight flex-1">{getSessionTitle(activeSession, 0)}</span>
                <span class={isMobile ? "hidden" : "absolute right-1 top-1/2 -translate-y-1/2 inline-flex items-center gap-0.5 opacity-0 pointer-events-none transition-opacity group-hover/session:opacity-100 group-hover/session:pointer-events-auto group-focus-within/session:opacity-100 group-focus-within/session:pointer-events-auto"}>
                  <button
                    type="button"
                    class="p-0.5 rounded text-text-tertiary hover:text-text-primary hover:bg-bg-hover-strong transition-colors"
                    draggable="false"
                    title="Insert"
                    onclick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
						insertPathReference(`/sessions/${activeSession.id}.jsonl`);
                    }}
                  >
                    <FileText class="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    class="p-0.5 rounded text-text-tertiary hover:text-text-primary hover:bg-bg-hover-strong transition-colors"
                    draggable="false"
                    title={isPinned("session", activeSession.id) ? "Unpin chat" : "Pin chat"}
                    onclick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      togglePinResource("session", activeSession.id, getSessionTitle(activeSession, 0));
                    }}
                  >
                    {#if isPinned("session", activeSession.id)}
                      <PinOff class="w-3.5 h-3.5" />
                    {:else}
                      <Pin class="w-3.5 h-3.5" />
                    {/if}
                  </button>
                  <button
                    type="button"
                    class="p-0.5 rounded text-text-tertiary hover:text-text-primary hover:bg-bg-hover-strong transition-colors"
                    draggable="false"
                    title="Rename"
                    onclick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      startRenameSession(activeSession);
                    }}
                  >
                    <Pencil class="w-3.5 h-3.5" />
                  </button>
                </span>
              </a>
            {/if}
          {/if}

          <div class="mt-3">
            <button
              type="button"
              class="flex items-center gap-2 px-2 py-1.5 w-full text-left hover:bg-bg-hover transition-colors duration-100 rounded-[6px]"
              onclick={() => { checkpointsCollapsed = !checkpointsCollapsed; }}
              title={checkpointsCollapsed ? "Expand saves" : "Collapse saves"}
            >
              <ChevronDown class="w-3 h-3 text-text-tertiary shrink-0 transition-transform duration-150 {checkpointsCollapsed ? 'rotate-180' : ''}" />
              <span class="text-[11px] text-text-placeholder select-none">Saves</span>
            </button>

            {#if !checkpointsCollapsed}
              {#if loadingCheckpoints && checkpoints.length === 0}
                <div class="px-2 py-2 text-[12px] text-text-tertiary flex items-center gap-2">
                  <Loader2 class="w-3 h-3 animate-spin" />
                  Loading saves...
                </div>
              {:else if checkpoints.length === 0}
                <div class="px-2 py-2 text-[12px] text-text-placeholder">No saves</div>
              {:else}
                <div class="space-y-[2px] mt-1">
                  {#each checkpoints.slice(0, 20) as checkpoint (checkpoint.id)}
                    {@const isActive = activeCheckpointId === checkpoint.id}
                    <a
                      href={buildSpaceCheckpointRoute(currentSpaceId!, checkpoint.id)}
                      class="group/checkpoint relative flex items-center gap-2 overflow-hidden px-2 py-1.5 pr-8 mx-[-2px] rounded-[6px] text-[13px] transition-colors duration-100 {isActive ? 'text-text-primary bg-bg-active font-medium' : 'text-text-tertiary hover:text-text-secondary hover:bg-bg-hover'}"
                      onclick={(e) => { e.preventDefault(); handleNavigateToCheckpoint(checkpoint.id); }}
                    >
                      <History class="w-3.5 h-3.5 shrink-0 text-text-placeholder" />
                      <div class="min-w-0 flex-1">
                        <div class="truncate leading-tight">{getCheckpointTitle(checkpoint)}</div>
                        <div class="mt-0.5 text-[10px] text-text-placeholder font-mono">{checkpoint.commitHash.slice(0, 12)}</div>
                      </div>
                      <button
                        type="button"
                        class={isMobile ? "hidden" : "absolute right-1 top-1/2 -translate-y-1/2 inline-flex p-0.5 rounded text-text-tertiary hover:text-text-primary hover:bg-bg-hover-strong transition-opacity opacity-0 pointer-events-none group-hover/checkpoint:opacity-100 group-hover/checkpoint:pointer-events-auto group-focus-within/checkpoint:opacity-100 group-focus-within/checkpoint:pointer-events-auto"}
                        draggable="false"
                        title={isPinned("checkpoint", checkpoint.id) ? "Unpin save" : "Pin save"}
                        onclick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          togglePinResource("checkpoint", checkpoint.id, getCheckpointTitle(checkpoint));
                        }}
                      >
                        {#if isPinned("checkpoint", checkpoint.id)}
                          <PinOff class="w-3.5 h-3.5" />
                        {:else}
                          <Pin class="w-3.5 h-3.5" />
                        {/if}
                      </button>
                    </a>
                  {/each}
                </div>
              {/if}
            {:else if activeCheckpoint}
              <a
                href={buildSpaceCheckpointRoute(currentSpaceId!, activeCheckpoint.id)}
                class="flex items-center gap-2 px-2 py-1.5 mx-[-2px] mt-1 rounded-[6px] text-[13px] transition-colors duration-100 text-text-primary bg-bg-active font-medium"
                onclick={(e) => { e.preventDefault(); handleNavigateToCheckpoint(activeCheckpoint.id); }}
              >
                <History class="w-3.5 h-3.5 shrink-0 text-text-placeholder" />
                <div class="min-w-0 flex-1">
                  <div class="truncate leading-tight">{getCheckpointTitle(activeCheckpoint)}</div>
                  <div class="mt-0.5 text-[10px] text-text-placeholder font-mono">{activeCheckpoint.commitHash.slice(0, 12)}</div>
                </div>
              </a>
            {/if}
          </div>

          <!-- Scheduled Jobs -->
          <div class="mt-3">
            <div
              class="flex items-center gap-2 px-2 py-1.5 w-full text-left hover:bg-bg-hover transition-colors duration-100 rounded-[6px] cursor-pointer"
              onclick={() => { cronjobsCollapsed = !cronjobsCollapsed; }}
              title={cronjobsCollapsed ? "Expand scheduled" : "Collapse scheduled"}
              role="button"
              tabindex="0"
              onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); cronjobsCollapsed = !cronjobsCollapsed; } }}
            >
              <ChevronDown class="w-3 h-3 text-text-tertiary shrink-0 transition-transform duration-150 {cronjobsCollapsed ? 'rotate-180' : ''}" />
              <span class="text-[11px] text-text-placeholder select-none">Scheduled</span>
              <span
                class="ml-auto p-0.5 rounded hover:bg-bg-hover text-text-placeholder hover:text-text-secondary transition-colors cursor-pointer"
                onclick={(e) => { e.stopPropagation(); handleNavigateToNewCronjob(); }}
                onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); e.preventDefault(); handleNavigateToNewCronjob(); } }}
                title="New scheduled"
                role="button"
                tabindex="0"
              >
                <Plus class="w-3 h-3" />
              </span>
            </div>

            {#if !cronjobsCollapsed}
              {#if loadingCronjobs && cronjobs.length === 0}
                <div class="px-2 py-2 text-[12px] text-text-tertiary flex items-center gap-2">
                  <Loader2 class="w-3 h-3 animate-spin" />
                  Loading scheduled...
                </div>
              {:else if cronjobs.length === 0}
                <div class="px-2 py-2 text-[12px] text-text-placeholder">No scheduled</div>
              {:else}
                <div class="space-y-[2px] mt-1">
                  {#each cronjobs.slice(0, 20) as job (job.id)}
                    {@const isActive = activeCronjobId === job.id}
                    <a
                      href={buildSpaceCronjobRoute(currentSpaceId!, job.id)}
                      class="flex items-center gap-2 px-2 py-1.5 mx-[-2px] rounded-[6px] text-[13px] transition-colors duration-100 {isActive ? 'text-text-primary bg-bg-active font-medium' : 'text-text-tertiary hover:text-text-secondary hover:bg-bg-hover'}"
                      onclick={(e) => { e.preventDefault(); handleNavigateToCronjob(job.id); }}
                    >
                      <Clock class="w-3.5 h-3.5 shrink-0 text-text-placeholder" />
                      <div class="min-w-0 flex-1">
                        <div class="truncate leading-tight">{job.title}</div>
                      </div>
                      <span class="w-[6px] h-[6px] rounded-full shrink-0 {job.enabled ? 'bg-status-running' : 'bg-text-placeholder'}"></span>
                    </a>
                  {/each}
                </div>
              {/if}
            {:else if activeCronjob}
              <a
                href={buildSpaceCronjobRoute(currentSpaceId!, activeCronjob.id)}
                class="flex items-center gap-2 px-2 py-1.5 mx-[-2px] mt-1 rounded-[6px] text-[13px] transition-colors duration-100 text-text-primary bg-bg-active font-medium"
                onclick={(e) => { e.preventDefault(); handleNavigateToCronjob(activeCronjob.id); }}
              >
                <Clock class="w-3.5 h-3.5 shrink-0 text-text-placeholder" />
                <div class="min-w-0 flex-1">
                  <div class="truncate leading-tight">{activeCronjob.title}</div>
                </div>
                <span class="w-[6px] h-[6px] rounded-full shrink-0 {activeCronjob.enabled ? 'bg-status-running' : 'bg-text-placeholder'}"></span>
              </a>
            {/if}
          </div>

          <!-- Tasks -->
          <div class="mt-3">
            <button
              type="button"
              class="flex items-center gap-2 px-2 py-1.5 w-full text-left hover:bg-bg-hover transition-colors duration-100 rounded-[6px]"
              onclick={() => { tasksCollapsed = !tasksCollapsed; }}
              title={tasksCollapsed ? "Expand tasks" : "Collapse tasks"}
            >
              <ChevronDown class="w-3 h-3 text-text-tertiary shrink-0 transition-transform duration-150 {tasksCollapsed ? 'rotate-180' : ''}" />
              <span class="text-[11px] text-text-placeholder select-none">Tasks</span>
            </button>

            {#if !tasksCollapsed}
              {#if loadingTasks && tasks.length === 0}
                <div class="px-2 py-2 text-[12px] text-text-tertiary flex items-center gap-2">
                  <Loader2 class="w-3 h-3 animate-spin" />
                  Loading tasks...
                </div>
              {:else if tasks.length === 0}
                <div class="px-2 py-2 text-[12px] text-text-placeholder">No tasks</div>
              {:else}
                <div class="space-y-[2px] mt-1">
                  {#each tasks.slice(0, 15) as run (run.id)}
                    {@const isActive = activeTaskId === run.id}
                    {@const badge = run.status === 'completed' ? { color: 'text-status-running', dot: 'bg-status-running' }
                      : run.status === 'failed' ? { color: 'text-status-error', dot: 'bg-status-error' }
                      : run.status === 'running' ? { color: 'text-info', dot: 'bg-info' }
                      : { color: 'text-text-placeholder', dot: 'bg-text-placeholder' }}
                    <a
                      href={buildSpaceTaskRoute(currentSpaceId!, run.id)}
                      class="flex items-center gap-2 px-2 py-1.5 mx-[-2px] rounded-[6px] text-[13px] transition-colors duration-100 {isActive ? 'text-text-primary bg-bg-active font-medium' : 'text-text-tertiary hover:text-text-secondary hover:bg-bg-hover'}"
                      onclick={(e) => { e.preventDefault(); handleNavigateToTask(run.id); }}
                    >
                      <Activity class="w-3.5 h-3.5 shrink-0 text-text-placeholder" />
                      <div class="min-w-0 flex-1">
                        <div class="truncate leading-tight text-[12px] capitalize {badge.color}">{run.status}</div>
                        <div class="mt-0.5 text-[10px] text-text-placeholder">{(() => { const d = new Date(run.createdAt ?? run.scheduledAt); return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); })()}</div>
                      </div>
                      <span class="w-[6px] h-[6px] rounded-full shrink-0 {badge.dot}"></span>
                    </a>
                  {/each}
                </div>
              {/if}
            {:else if activeTaskId}
              <a
                href={buildSpaceTaskRoute(currentSpaceId!, activeTaskId)}
                class="flex items-center gap-2 px-2 py-1.5 mx-[-2px] mt-1 rounded-[6px] text-[13px] transition-colors duration-100 text-text-primary bg-bg-active font-medium"
                onclick={(e) => { e.preventDefault(); handleNavigateToTask(activeTaskId); }}
              >
                <Activity class="w-3.5 h-3.5 shrink-0 text-text-placeholder" />
                <div class="min-w-0 flex-1">
                  <div class="truncate leading-tight text-[12px]">Task run</div>
                </div>
              </a>
            {/if}
          </div>
        {/if}
      </div>
    {:else}
      <div class="flex-1 overflow-y-auto px-1 pb-2 pt-1 min-h-0">
        <div class="px-1 py-6 text-[12px] text-text-placeholder text-center">
          Select a space to view chats
        </div>
      </div>
    {/if}
  {:else}
    <div class="px-2 pt-2 pb-1">
      <button
        type="button"
        class="flex w-full items-center gap-2 rounded-[5px] px-2.5 py-2 text-[13px] text-text-tertiary transition-colors duration-100 hover:bg-bg-hover hover:text-text-secondary"
        onclick={returnFromSettings}
      >
        <ArrowLeft class="w-[15px] h-[15px] shrink-0" />
        <span class="truncate">Back</span>
      </button>
    </div>
    <nav class="flex-1 overflow-y-auto px-2 py-2 space-y-[2px]">
      {#each settingsTabs as tab (tab.id)}
        {@const isActive = activeSettingsTab === tab.id}
        <a
          href={tab.href}
          class="flex items-center gap-2.5 px-2.5 py-2 rounded-[5px] text-[13px] transition-colors duration-100 cursor-pointer {
            isActive
              ? 'bg-bg-active text-text-primary font-medium'
              : 'text-text-tertiary hover:text-text-secondary hover:bg-bg-hover'
          }"
          onclick={(e) => { e.preventDefault(); handleNavigate(tab.href, { keepSettingsReturn: true }); }}
        >
          <tab.icon class="w-[15px] h-[15px] shrink-0" />
          <span>{tab.label}</span>
        </a>
      {/each}
    </nav>
  {/if}

  <!-- User Menu -->
  <div class="border-t border-border-subtle p-1.5 shrink-0 relative">
    {#if showUserMenu}
      <div
        data-user-menu
        class="absolute bottom-full left-1.5 right-1.5 mb-1 bg-bg-primary border border-border-subtle rounded-md shadow-lg overflow-hidden z-50"
      >
        {#if mode === "space"}
          <a
            href="/settings"
            class="flex items-center gap-2 px-2.5 py-[7px] text-[12px] text-text-tertiary hover:text-text-secondary hover:bg-bg-hover transition-colors duration-100"
            onclick={(e) => { e.preventDefault(); openSettings(); }}
          >
            <Settings class="w-3.5 h-3.5" />
            <span>Settings</span>
          </a>
        {:else}
          <a
            href="/"
            class="flex items-center gap-2 px-2.5 py-[7px] text-[12px] text-text-tertiary hover:text-text-secondary hover:bg-bg-hover transition-colors duration-100"
            onclick={(e) => { e.preventDefault(); showUserMenu = false; handleNavigate('/'); }}
          >
            <FolderKanban class="w-3.5 h-3.5" />
            <span>Spaces</span>
          </a>
        {/if}
        <a
          href="/explore"
          class="flex items-center gap-2 px-2.5 py-[7px] text-[12px] text-text-tertiary hover:text-text-secondary hover:bg-bg-hover transition-colors duration-100"
          onclick={(e) => { e.preventDefault(); showUserMenu = false; handleNavigate('/explore'); }}
        >
          <Compass class="w-3.5 h-3.5" />
          <span>Explore</span>
        </a>
        <a
          href="/trending"
          class="flex items-center gap-2 px-2.5 py-[7px] text-[12px] text-text-tertiary hover:text-text-secondary hover:bg-bg-hover transition-colors duration-100"
          onclick={(e) => { e.preventDefault(); showUserMenu = false; handleNavigate('/trending'); }}
        >
          <BarChart3 class="w-3.5 h-3.5" />
          <span>Trending</span>
        </a>
        <button
          class="flex items-center gap-2 w-full px-2.5 py-[7px] text-[12px] text-text-tertiary hover:text-error-soft hover:bg-bg-hover transition-colors duration-100"
          onclick={() => { showUserMenu = false; void handleLogout(); }}
        >
          <LogOut class="w-3.5 h-3.5" />
          <span>Sign out</span>
        </button>
      </div>
    {/if}

    <button
      type="button"
      data-user-menu
      class="flex items-center gap-2 w-full px-2 py-[6px] rounded-[5px] hover:bg-bg-hover transition-colors duration-100 cursor-pointer"
      onclick={() => { showUserMenu = !showUserMenu; }}
    >
      <div class="w-[22px] h-[22px] rounded-full bg-bg-hover-strong overflow-hidden shrink-0">
        {#if authStore.profile?.avatarUrl}
          <img src={authStore.profile.avatarUrl} alt="avatar" class="w-full h-full object-cover" />
        {:else}
          <svg viewBox="0 0 32 32" class="w-full h-full" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect width="32" height="32" rx="16" fill="#e5e7eb" />
            <circle cx="16" cy="12" r="5" fill="#9ca3af" />
            <ellipse cx="16" cy="26" rx="9" ry="7" fill="#9ca3af" />
          </svg>
        {/if}
      </div>
      <div class="flex-1 min-w-0 text-left">
        <p class="text-[12px] text-text-secondary truncate">{userDisplayName}</p>
      </div>
      <ChevronDown class={'w-3 h-3 text-text-tertiary shrink-0 transition-transform duration-150 ' + (showUserMenu ? 'rotate-180' : '')} />
    </button>
  </div>
</aside>

<!-- Space Switcher Modal -->
<Dialog open={showSpaceModal} onClose={() => { showSpaceModal = false; }} title="Switch Space" maxWidth="340px">
  <div class="py-1">
    {#if isLoading}
      <div class="px-4 py-6 text-[12px] text-text-tertiary text-center flex items-center justify-center gap-2">
        <Loader2 class="w-3 h-3 animate-spin" />
        Loading...
      </div>
    {:else if loadError}
      <div class="px-4 py-3 text-[12px] text-error-soft text-center">{loadError}</div>
    {:else if spaces.length === 0}
      <div class="px-4 py-6 text-center">
        <p class="text-[13px] text-text-tertiary">No spaces yet</p>
        <p class="text-[11px] text-text-placeholder mt-1">Create your first space to get started</p>
      </div>
    {:else}
      {#if recentSpaces.length > 0}
        <div class="px-4 pb-1 pt-2 text-[10px] font-medium uppercase tracking-wider text-text-placeholder">Recent</div>
        {#each recentSpaces as space (space.id)}
          {@const isActive = currentSpaceId === space.id}
          {@const status = displayStatus(space)}
          <button
            type="button"
            class="w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors duration-100 {isActive ? 'bg-bg-active' : 'hover:bg-bg-hover'}"
            onclick={() => { void handleNavigateToSpace(space.id); }}
          >
            <span class="w-2 h-2 rounded-full shrink-0 {statusColorClass(status)}"></span>

            <div class="flex-1 min-w-0">
              <div class="text-[13px] truncate {isActive ? 'text-text-primary font-medium' : 'text-text-secondary'}">
                {space.name || space.title || space.id.slice(0, 12)}
              </div>
              <div class="flex items-center gap-1.5 mt-0.5">
                {#if space.userUuid !== authStore.userUuid}
                  <Users class="w-2.5 h-2.5 text-text-placeholder" />
                  <span class="text-[10px] text-text-placeholder">Shared</span>
                {:else}
                  <span class="text-[10px] text-text-placeholder">Recently used</span>
                {/if}
              </div>
            </div>

            {#if isActive}
              <span class="w-1.5 h-1.5 rounded-full bg-brand shrink-0"></span>
            {/if}
          </button>
        {/each}
      {/if}

      {#if otherSpaces.length > 0}
        {#if recentSpaces.length > 0}
          <div class="mt-1 border-t border-border-subtle"></div>
        {/if}
        <div class="px-4 pb-1 pt-2 text-[10px] font-medium uppercase tracking-wider text-text-placeholder">All Spaces</div>
        {#each otherSpaces as space (space.id)}
          {@const isActive = currentSpaceId === space.id}
          {@const status = displayStatus(space)}
          <button
            type="button"
            class="w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors duration-100 {isActive ? 'bg-bg-active' : 'hover:bg-bg-hover'}"
            onclick={() => { void handleNavigateToSpace(space.id); }}
          >
            <span class="w-2 h-2 rounded-full shrink-0 {statusColorClass(status)}"></span>

            <div class="flex-1 min-w-0">
              <div class="text-[13px] truncate {isActive ? 'text-text-primary font-medium' : 'text-text-secondary'}">
                {space.name || space.title || space.id.slice(0, 12)}
              </div>
              {#if space.userUuid !== authStore.userUuid}
                <div class="flex items-center gap-1 mt-0.5">
                  <Users class="w-2.5 h-2.5 text-text-placeholder" />
                  <span class="text-[10px] text-text-placeholder">Shared</span>
                </div>
              {/if}
            </div>

            {#if isActive}
              <span class="w-1.5 h-1.5 rounded-full bg-brand shrink-0"></span>
            {/if}
          </button>
        {/each}
      {/if}
    {/if}
  </div>
  {#snippet footer()}
    <button
      type="button"
      class="w-full flex items-center gap-2 px-4 py-2.5 text-[13px] text-brand hover:bg-bg-hover transition-colors duration-100"
      onclick={() => { showSpaceModal = false; handleNavigate("/spaces/new"); }}
    >
      <Plus class="w-3.5 h-3.5" />
      <span>New Space</span>
    </button>
  {/snippet}
</Dialog>
