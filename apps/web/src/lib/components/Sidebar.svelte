<script lang="ts">
import type {
	BillingCreditStatus,
	CheckpointRecord,
	CronJobRecord,
	SessionForkRecord,
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
	CreditCard,
	Download,
	FileText,
	FolderKanban,
	History,
	Keyboard,
	KeyRound,
	LayoutDashboard,
	Loader2,
	LogOut,
	Network,
	NotebookPen,
	PanelLeftClose,
	PanelLeftOpen,
	Pencil,
	Pin,
	PinOff,
	Plus,
	Save,
	Search,
	Settings,
	Trash2,
	User,
	X,
} from "lucide-svelte";
import { onMount, tick, untrack } from "svelte";
import { goto } from "$app/navigation";
import { page } from "$app/state";
import { logtoClient } from "$lib/auth";
import { handleUnauthorizedError } from "$lib/auth-redirect";
import { clearAllIndexedDbCache } from "$lib/cache/clear";
import { getCacheUserKey } from "$lib/cache/keys";
import SessionSidebarRowContent from "$lib/components/SessionSidebarRowContent.svelte";
import SidebarFlyout from "$lib/components/SidebarFlyout.svelte";
import SpaceAvatar from "$lib/components/SpaceAvatar.svelte";
import { downloadCohubDebugBundle } from "$lib/debugger";
import { isComposingKeyboardEvent } from "$lib/keyboard";
import { formatSpaceMentionTextForDisplay } from "$lib/mentions/space";
import { sdk } from "$lib/sdk";
import { getSessionSortTime } from "$lib/session-sort";
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
import { clearRecentSpace, setRecentSpace } from "$lib/stores/recent-space";
import {
	clearAllCachedSessionLists,
	getCachedSessionListSnapshot,
	onSessionListCacheUpdated,
	patchCachedSessionList,
	setCachedSessionList,
} from "$lib/stores/session-list-cache";
import { unreadTracker } from "$lib/stores/session-state.svelte";
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
import {
	cacheSpaceRecordSoon,
	getCachedSpaceRecord,
} from "$lib/stores/space-record-cache";
import {
	onTaskRunsCacheUpdated,
	setCachedTaskRuns,
} from "$lib/stores/task-runs-cache";
import { uiState } from "$lib/stores/ui.svelte";

const {
	isMobile = false,
	onClose,
	mode = "space",
	collapsed = false,
}: {
	isMobile?: boolean;
	onClose?: () => void;
	mode?: "space" | "settings";
	collapsed?: boolean;
} = $props();

const SESSION_PAGE_SIZE = 20;

let showUserMenu = $state(false);
let spaces = $state<SpaceRecord[]>([]);
let sessions = $state<SessionRecord[]>([]);
type SessionForkSidebarRecord = Partial<SessionForkRecord> & {
	childSessionId: string;
	parentSessionId?: string | null;
	depth: number;
	anchorSequence?: number | null;
	createdAt?: string;
	firstUserTextAfterFork?: string | null;
	parentTitle?: string | null;
};
type SidebarSessionItem = {
	session: SessionRecord;
	depth: number;
	visualDepth: number;
	isFork: boolean;
	parentVisible: boolean;
	isLastVisibleChild: boolean;
	fork: SessionForkSidebarRecord | null;
	displayTitle: string;
	titleText: string | undefined;
	ariaLabel: string;
};
let sessionForks = $state<SessionForkSidebarRecord[]>([]);
let checkpoints = $state<CheckpointRecord[]>([]);
let pinnedMarks = $state<SpaceMarkListItem[]>([]);
let loadingSessions = $state(false);
let loadingSessionsSpaceId = $state<string | null>(null);
let loadingMoreSessions = $state(false);
let sessionsPageInfo = $state<{ hasMore: boolean; nextCursor: string | null }>({
	hasMore: false,
	nextCursor: null,
});
let exhaustedFallbackSessionCursor = $state<string | null>(null);
let loadingCheckpoints = $state(false);
let loadingCheckpointsSpaceId = $state<string | null>(null);
let billingCredit = $state<BillingCreditStatus | null>(null);
let billingCreditLoading = $state(false);
let billingCreditError = $state<string | null>(null);
let billingCreditUserId = $state<string | null>(null);

let sessionsCollapsed = $state(false);
let checkpointsCollapsed = $state(false);
let cronjobsCollapsed = $state(false);
let tasksCollapsed = $state(false);
let creatingSession = $state(false);
let createSessionError = $state("");
const sidebarFlyoutPreviewLimit = 24;

// Session rename state
let renamingSessionId = $state<string | null>(null);
let renameTitleValue = $state("");
let renameSaving = $state(false);
let renameInputElement: HTMLInputElement | null = $state(null);

let cronjobs = $state<CronJobRecord[]>([]);
let tasks = $state<TaskRunRecord[]>([]);
let loadingCronjobs = $state(false);
let loadingCronjobsSpaceId = $state<string | null>(null);
let loadingTasks = $state(false);
let loadingTasksSpaceId = $state<string | null>(null);

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
const sidebarSessionItems = $derived.by(() =>
	buildSidebarSessionItems(sessions),
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

const userDisplayName = $derived(
	authStore.profile?.displayName?.trim() || "User",
);

let billingCreditRequest: Promise<boolean> | null = null;

function clearBillingCredit() {
	billingCredit = null;
	billingCreditLoading = false;
	billingCreditError = null;
	billingCreditUserId = null;
}

function formatUsdAmount(value: number | null | undefined) {
	const amount =
		typeof value === "number" && Number.isFinite(value) ? value : 0;
	const sign = amount < 0 ? "-" : "";
	return `${sign}$${Math.abs(amount).toFixed(8)}`;
}

async function refreshBillingCredit() {
	if (billingCreditRequest) return billingCreditRequest;
	billingCreditLoading = true;
	billingCreditError = null;
	billingCreditRequest = (async () => {
		try {
			const { credit } = await sdk.billing.getCredits();
			if (!credit.billing.configured) {
				clearBillingCredit();
				return false;
			}
			billingCredit = credit;
			billingCreditUserId = authStore.userUuid;
			return true;
		} catch (error) {
			if (await handleUnauthorizedError(error)) {
				clearBillingCredit();
				return false;
			}
			console.warn("[sidebar] Failed to load billing credit", error);
			billingCreditError = "Failed to refresh";
			return false;
		} finally {
			billingCreditLoading = false;
			billingCreditRequest = null;
		}
	})();
	return billingCreditRequest;
}

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

function getTaskRunBadge(status: TaskRunRecord["status"]) {
	if (status === "completed") {
		return { color: "text-status-running", dot: "bg-status-running" };
	}
	if (status === "failed") {
		return { color: "text-status-error", dot: "bg-status-error" };
	}
	if (status === "running") {
		return { color: "text-info", dot: "bg-info" };
	}
	return { color: "text-text-placeholder", dot: "bg-text-placeholder" };
}

function formatTaskRunTime(run: TaskRunRecord) {
	const rawDate = run.createdAt ?? run.scheduledAt;
	if (!rawDate) return "—";
	const date = new Date(rawDate);
	if (Number.isNaN(date.getTime())) return "—";
	return date.toLocaleString("en-US", {
		month: "short",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	});
}

function getFallbackSessionCursor(sessionList: SessionRecord[]) {
	return sessionList.at(-1)?.lastMessageAt ?? null;
}

function mergeSpaceIntoSidebarList(space: SpaceRecord) {
	spaces = [space, ...spaces.filter((item) => item.id !== space.id)];
}

const currentSpaceRefreshes = new Map<string, Promise<void>>();

async function loadCurrentSpaceFromUrl(
	spaceId = currentSpaceId,
	options?: { refresh?: boolean },
) {
	if (!spaceId) return;
	const alreadyLoaded = spaces.some((space) => space.id === spaceId);

	if (!alreadyLoaded) {
		const cached = await getCachedSpaceRecord(spaceId).catch(() => null);
		if (spaceId !== currentSpaceId) return;
		if (cached?.space) mergeSpaceIntoSidebarList(cached.space);
	}

	if (!options?.refresh && currentSpaceRefreshes.has(spaceId)) return;

	let refresh!: Promise<void>;
	refresh = (async () => {
		try {
			const space = await sdk.space(spaceId).get();
			if (spaceId !== currentSpaceId) return;
			mergeSpaceIntoSidebarList(space);
			cacheSpaceRecordSoon(space);
		} catch (error) {
			if (spaceId !== currentSpaceId) return;
			console.warn("[sidebar] Failed to load current space", {
				spaceId,
				error,
			});
		} finally {
			if (currentSpaceRefreshes.get(spaceId) === refresh) {
				currentSpaceRefreshes.delete(spaceId);
			}
		}
	})();

	currentSpaceRefreshes.set(spaceId, refresh);
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

async function loadSpaces(force = false) {
	await authStore.ensureLoaded();
	const requestedSpaceId = currentSpaceId;

	// The current URL is the source of truth for the selected space. Load it
	// directly first so guest-access spaces still render even if the broader
	// space list does not include them (or becomes paginated later).
	await loadCurrentSpaceFromUrl(requestedSpaceId);

	if (!authStore.isAuthenticated) {
		return;
	}

	if (!force) {
		const cached = getCachedSpaceList();
		if (cached && cached.length > 0) {
			spaces = requestedSpaceId
				? [
						...spaces.filter((space) => space.id === requestedSpaceId),
						...cached.filter((space) => space.id !== requestedSpaceId),
					]
				: cached;
		}
	}

	const cacheMeta = getCachedSpaceListMeta();
	const shouldFetch = force || !cacheMeta || cacheMeta.isStale;
	if (!shouldFetch) return;

	try {
		const listedSpaces = await fetchSpaceListWithCache(
			async () => await sdk.spaces.list(),
			{ force },
		);
		spaces = requestedSpaceId
			? [
					...spaces.filter((space) => space.id === requestedSpaceId),
					...listedSpaces.filter((space) => space.id !== requestedSpaceId),
				]
			: listedSpaces;
	} catch (error) {
		if (await handleUnauthorizedError(error)) {
			return;
		}
		console.warn("[sidebar] Failed to load spaces", error);
	}

	await loadCurrentSpaceFromUrl(requestedSpaceId);
}

async function loadSessionsForSpace(spaceId: string, force = false) {
	if (!force && loadingSessions && loadingSessionsSpaceId === spaceId) return;

	if (!force) {
		const cached = await getCachedSessionListSnapshot(spaceId);
		if (spaceId !== currentSpaceId) return;
		if (cached && cached.sessions.length > 0) {
			sessions = cached.sessions;
			sessionForks = cached.forks ?? [];
			sessionsPageInfo = cached.pageInfo;
		}
	}

	const shouldShowLoading = sessions.length === 0;
	if (shouldShowLoading) {
		loadingSessions = true;
		loadingSessionsSpaceId = spaceId;
	}

	const cachedSnapshot = await getCachedSessionListSnapshot(spaceId);
	if (spaceId !== currentSpaceId) {
		if (loadingSessionsSpaceId === spaceId) {
			loadingSessions = false;
			loadingSessionsSpaceId = null;
		}
		return;
	}
	const shouldFetch = force || !cachedSnapshot || cachedSnapshot.stale;
	if (!shouldFetch) {
		if (loadingSessionsSpaceId === spaceId) {
			loadingSessions = false;
			loadingSessionsSpaceId = null;
		}
		return;
	}

	try {
		const result = await sdk.space(spaceId).sessions.list({
			limit: SESSION_PAGE_SIZE,
			includeForks: true,
		});
		if (spaceId !== currentSpaceId) return;
		const nextSessions = result.sessions ?? [];
		const nextPageInfo = result.pageInfo ?? {
			hasMore: false,
			nextCursor: null,
		};
		const nextForks = result.forks ?? [];
		sessionForks = nextForks;
		sessions = await setCachedSessionList(
			spaceId,
			nextSessions,
			nextPageInfo,
			nextForks,
		);
		if (spaceId !== currentSpaceId) return;
		sessionsPageInfo = nextPageInfo;
	} catch (error) {
		console.warn("[sidebar] Failed to load sessions", { spaceId, error });
	} finally {
		if (loadingSessionsSpaceId === spaceId) {
			loadingSessions = false;
			loadingSessionsSpaceId = null;
		}
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
			includeForks: true,
		});
		const moreSessions = result.sessions ?? [];
		const nextPageInfo = result.pageInfo ?? {
			hasMore: false,
			nextCursor: null,
		};
		const forkByChildId = new Map(
			sessionForks.map((fork) => [fork.childSessionId, fork]),
		);
		for (const fork of result.forks ?? [])
			forkByChildId.set(fork.childSessionId, fork);
		sessionForks = Array.from(forkByChildId.values());
		sessions = await patchCachedSessionList(
			spaceId,
			(current) => [...current, ...moreSessions],
			nextPageInfo,
			sessionForks,
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
		if (spaceId !== currentSpaceId) return;
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
		if (spaceId === currentSpaceId) pinnedMarks = marks;
	} catch {
		if (spaceId === currentSpaceId && !getCachedSpacePins(spaceId))
			pinnedMarks = [];
	}
}

async function loadCheckpointsForSpace(spaceId: string, force = false) {
	if (!force && loadingCheckpoints && loadingCheckpointsSpaceId === spaceId)
		return;
	const shouldShowLoading = checkpoints.length === 0;
	if (shouldShowLoading) {
		loadingCheckpoints = true;
		loadingCheckpointsSpaceId = spaceId;
	}
	try {
		const result = await sdk.space(spaceId).checkpoints.list();
		if (spaceId === currentSpaceId) checkpoints = result.checkpoints ?? [];
	} catch (error) {
		console.warn("[sidebar] Failed to load checkpoints", { spaceId, error });
	} finally {
		if (loadingCheckpointsSpaceId === spaceId) {
			loadingCheckpoints = false;
			loadingCheckpointsSpaceId = null;
		}
	}
}

async function loadCronjobsForSpace(spaceId: string, force = false) {
	if (!force && loadingCronjobs && loadingCronjobsSpaceId === spaceId) return;
	const shouldShowLoading = cronjobs.length === 0;
	if (shouldShowLoading) {
		loadingCronjobs = true;
		loadingCronjobsSpaceId = spaceId;
	}
	try {
		const result = await sdk.cronJobs.list(spaceId);
		if (spaceId === currentSpaceId) cronjobs = result.jobs ?? [];
	} catch (error) {
		console.warn("[sidebar] Failed to load cronjobs", { spaceId, error });
	} finally {
		if (loadingCronjobsSpaceId === spaceId) {
			loadingCronjobs = false;
			loadingCronjobsSpaceId = null;
		}
	}
}

async function loadTasksForSpace(spaceId: string, force = false) {
	if (!force && loadingTasks && loadingTasksSpaceId === spaceId) return;
	const shouldShowLoading = tasks.length === 0;
	if (shouldShowLoading) {
		loadingTasks = true;
		loadingTasksSpaceId = spaceId;
	}
	try {
		const result = await sdk.tasks.list({ spaceId });
		if (spaceId === currentSpaceId) {
			tasks = result.runs ?? [];
			setCachedTaskRuns(spaceId, tasks);
		}
	} catch (error) {
		console.warn("[sidebar] Failed to load tasks", { spaceId, error });
	} finally {
		if (loadingTasksSpaceId === spaceId) {
			loadingTasks = false;
			loadingTasksSpaceId = null;
		}
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

function openHelpPanel() {
	showUserMenu = false;
	onClose?.();
	window.dispatchEvent(new CustomEvent("cohub:open-help-panel"));
}

function openCommandPalette() {
	onClose?.();
	window.dispatchEvent(new CustomEvent("cohub:open-command-palette"));
}

function openSpacePalette() {
	onClose?.();
	window.dispatchEvent(
		new CustomEvent("cohub:open-command-palette", {
			detail: {
				title: "Switch Space",
				query: "a: ",
				placeholder: "Search spaces…",
			},
		}),
	);
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
	resourceType: "session" | "checkpoint" | "file" | "space",
	resourceRef: string,
) {
	return isSpacePin(pinnedMarks, resourceType, resourceRef);
}

function insertPathReference(path: string) {
	insertComposerSnippet(` \`${path}\` `);
	onClose?.();
}

function togglePinResource(
	resourceType: "session" | "checkpoint" | "file" | "space",
	resourceRef: string,
	label?: string | null,
) {
	if (!currentSpaceId && resourceType !== "space") return;
	void toggleSpacePin({
		spaceId:
			resourceType === "space" ? undefined : (currentSpaceId ?? undefined),
		resourceType,
		resourceRef,
		label,
	}).then((marks) => {
		pinnedMarks = marks;
	});
}

function getPinnedInsertReference(mark: SpaceMarkListItem) {
	if (mark.resourceType === "session")
		return `/sessions/${mark.resourceRef}.jsonl`;
	if (mark.resourceType === "file") return mark.resourceRef;
	return null;
}

function getPinnedIcon(resourceType: string) {
	if (resourceType === "space") return FolderKanban;
	if (resourceType === "session") return Activity;
	if (resourceType === "checkpoint") return History;
	return FileText;
}

function getPinnedFallbackTitle(mark: SpaceMarkListItem) {
	return mark.resource?.title ?? mark.label ?? mark.resourceRef;
}

function isPinnedMarkActive(mark: SpaceMarkListItem) {
	if (mark.resourceType === "space") return currentPath === mark.href;
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

function normalizeSessionDisplayText(value: string | null | undefined) {
	return formatSpaceMentionTextForDisplay(value ?? "")
		.replace(/\s+/g, " ")
		.replace(/^[:\-\s]+/, "")
		.trim();
}

function getSessionTitle(session: SessionRecord, _index: number) {
	const candidates = [session.title, session.latestMessageText];
	for (const candidate of candidates) {
		const normalized = normalizeSessionDisplayText(candidate);
		if (normalized) return normalized.slice(0, 36);
	}
	return "New chat";
}

function isLikelyDefaultForkTitle(
	session: SessionRecord,
	fork: SessionForkSidebarRecord | null,
) {
	if (!fork) return false;
	const childTitle = normalizeSessionDisplayText(session.title);
	if (!childTitle) return true;
	const parentTitle = normalizeSessionDisplayText(fork.parentTitle);
	return Boolean(parentTitle && childTitle === parentTitle);
}

function buildForkTitle(
	session: SessionRecord,
	fork: SessionForkSidebarRecord | null,
) {
	const forkText = normalizeSessionDisplayText(fork?.firstUserTextAfterFork);
	if (forkText && isLikelyDefaultForkTitle(session, fork))
		return forkText.slice(0, 48);
	return getSessionTitle(session, 0);
}

function getSessionRowStyle(item: SidebarSessionItem) {
	if (!item.isFork)
		return isMobile
			? "-webkit-touch-callout: none; user-select: none;"
			: undefined;
	const depth = isMobile ? Math.min(item.visualDepth, 1) : item.visualDepth;
	const indent = Math.min(depth, 3) * (isMobile ? 10 : 12);
	const base = `--fork-indent: ${indent}px;`;
	return isMobile
		? `${base} -webkit-touch-callout: none; user-select: none;`
		: base;
}

function getSessionActiveTime(session: SessionRecord) {
	return getSessionSortTime(session);
}

function buildSidebarSessionItems(
	sessionList: SessionRecord[],
): SidebarSessionItem[] {
	const sessionById = new Map(
		sessionList.map((session) => [session.id, session]),
	);
	const forkByChildId = new Map(
		sessionForks.map((fork) => [fork.childSessionId, fork]),
	);
	const childrenByParentId = new Map<string, SessionRecord[]>();
	const childIndexById = new Map<string, number>();
	const childCountByParentId = new Map<string, number>();

	for (const session of sessionList) {
		const fork = forkByChildId.get(session.id);
		if (!fork?.parentSessionId || !sessionById.has(fork.parentSessionId))
			continue;
		const siblings = childrenByParentId.get(fork.parentSessionId) ?? [];
		siblings.push(session);
		childrenByParentId.set(fork.parentSessionId, siblings);
	}

	const groupActiveTime = new Map<string, number>();
	const getGroupActiveTime = (
		session: SessionRecord,
		seen = new Set<string>(),
	) => {
		const cachedActiveTime = groupActiveTime.get(session.id);
		if (cachedActiveTime !== undefined) return cachedActiveTime;
		if (seen.has(session.id)) return getSessionActiveTime(session);
		seen.add(session.id);
		let activeTime = getSessionActiveTime(session);
		for (const child of childrenByParentId.get(session.id) ?? []) {
			activeTime = Math.max(activeTime, getGroupActiveTime(child, seen));
		}
		seen.delete(session.id);
		groupActiveTime.set(session.id, activeTime);
		return activeTime;
	};

	const compareSessions = (a: SessionRecord, b: SessionRecord) => {
		const activeDelta = getGroupActiveTime(b) - getGroupActiveTime(a);
		if (activeDelta !== 0) return activeDelta;
		return b.id.localeCompare(a.id);
	};

	for (const [parentId, children] of childrenByParentId) {
		const sortedChildren = children.sort(compareSessions);
		childCountByParentId.set(parentId, sortedChildren.length);
		sortedChildren.forEach((child, index) => {
			childIndexById.set(child.id, index);
		});
	}

	const roots = sessionList
		.filter((session) => {
			const fork = forkByChildId.get(session.id);
			return !fork?.parentSessionId || !sessionById.has(fork.parentSessionId);
		})
		.sort(compareSessions);

	const items: SidebarSessionItem[] = [];
	const appendSession = (
		session: SessionRecord,
		visualDepth: number,
		seen = new Set<string>(),
	) => {
		if (seen.has(session.id)) return;
		seen.add(session.id);
		const fork = forkByChildId.get(session.id) ?? null;
		const parentVisible = Boolean(
			fork?.parentSessionId && sessionById.has(fork.parentSessionId),
		);
		const connectedFork = parentVisible ? fork : null;
		const displayTitle = connectedFork
			? buildForkTitle(session, connectedFork)
			: getSessionTitle(session, 0);
		const source = connectedFork?.parentTitle
			? `Forked from “${normalizeSessionDisplayText(connectedFork.parentTitle)}”`
			: "Forked from another chat";
		const turn = connectedFork?.anchorSequence
			? ` at turn #${connectedFork.anchorSequence}`
			: "";
		const tooltip = connectedFork ? `${source}${turn}` : undefined;
		const childIndex = childIndexById.get(session.id);
		const childCount = fork?.parentSessionId
			? childCountByParentId.get(fork.parentSessionId)
			: undefined;
		const isLastVisibleChild = Boolean(
			connectedFork &&
				childIndex !== undefined &&
				childCount !== undefined &&
				childIndex === childCount - 1,
		);
		items.push({
			session,
			depth: connectedFork?.depth ?? 0,
			visualDepth: connectedFork ? visualDepth : 0,
			isFork: Boolean(connectedFork),
			parentVisible,
			isLastVisibleChild,
			fork: connectedFork,
			displayTitle,
			titleText: tooltip,
			ariaLabel: tooltip ? `${displayTitle}, ${tooltip}` : displayTitle,
		});

		const children = childrenByParentId.get(session.id) ?? [];
		for (const child of children) appendSession(child, visualDepth + 1, seen);
		seen.delete(session.id);
	};

	for (const root of roots) appendSession(root, 0);
	return items;
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

function saveDebugLog() {
	showUserMenu = false;
	onClose?.();
	downloadCohubDebugBundle();
}

function handleGlobalNewChatKeydown(event: KeyboardEvent) {
	if (isComposingKeyboardEvent(event)) return;
	const key = event.key.toLowerCase();
	const isNewChatShortcut = (event.metaKey || event.ctrlKey) && key === "o";
	if (isNewChatShortcut) {
		event.preventDefault();
		void handleCreateNewSession();
	}
}

onMount(() => {
	let offSpaceListCacheUpdated = () => {};
	let offSessionListCacheUpdated = () => {};
	let offSpacePinsCacheUpdated = () => {};
	let offTaskRunsCacheUpdated = () => {};
	if (mode === "space") {
		offSpaceListCacheUpdated = onSpaceListCacheUpdated(
			({ spaces: nextSpaces }) => {
				if (!authStore.isAuthenticated) return;
				spaces = nextSpaces;
			},
		);
		offSessionListCacheUpdated = onSessionListCacheUpdated(
			({ spaceId, sessions: nextSessions, forks, pageInfo }) => {
				if (spaceId !== currentSpaceId) return;
				sessions = nextSessions;
				sessionForks = forks ?? [];
				if (pageInfo) sessionsPageInfo = pageInfo;
				exhaustedFallbackSessionCursor = null;
			},
		);
		offSpacePinsCacheUpdated = onSpacePinsCacheUpdated(({ spaceId, marks }) => {
			if (spaceId !== currentSpaceId) return;
			pinnedMarks = marks;
		});
		offTaskRunsCacheUpdated = onTaskRunsCacheUpdated(({ spaceId, runs }) => {
			if (spaceId !== currentSpaceId) return;
			tasks = runs;
		});
		window.addEventListener("keydown", handleGlobalNewChatKeydown);
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
	}
	document.addEventListener("click", handleClickOutside);

	return () => {
		offSpaceListCacheUpdated();
		offSessionListCacheUpdated();
		offSpacePinsCacheUpdated();
		offTaskRunsCacheUpdated();
		document.removeEventListener("click", handleClickOutside);
		if (mode === "space") {
			window.removeEventListener("keydown", handleGlobalNewChatKeydown);
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

// Always load the space addressed by the current URL directly. The global
// space list is only a switcher data source and may omit guest-access spaces.
$effect(() => {
	const userId = authStore.userUuid;
	if (!authStore.isAuthenticated || !userId) {
		clearBillingCredit();
		return;
	}
	if (billingCreditUserId && billingCreditUserId !== userId) {
		clearBillingCredit();
	}
	if (!showUserMenu) return;
	untrack(() => {
		void refreshBillingCredit();
	});
});

$effect(() => {
	if (mode !== "space") return;
	const id = currentSpaceId;
	if (!id) return;

	untrack(() => {
		void loadCurrentSpaceFromUrl(id);
	});
});

$effect(() => {
	if (mode !== "space") return;
	const id = currentSpaceId;
	if (id) {
		sessions = [];
		sessionForks = [];
		pinnedMarks = [];
		checkpoints = [];
		cronjobs = [];
		tasks = [];
		sessionsPageInfo = { hasMore: false, nextCursor: null };
		exhaustedFallbackSessionCursor = null;
		loadingSessions = false;
		loadingSessionsSpaceId = null;
		loadingCheckpoints = false;
		loadingCheckpointsSpaceId = null;
		loadingCronjobs = false;
		loadingCronjobsSpaceId = null;
		loadingTasks = false;
		loadingTasksSpaceId = null;
		untrack(() => {
			void loadSessionsForSpace(id);
			void loadPinsForSpace(id);
			void loadCheckpointsForSpace(id, true);
			void loadCronjobsForSpace(id, true);
			void loadTasksForSpace(id, true);
		});
	} else {
		sessions = [];
		sessionForks = [];
		pinnedMarks = [];
		sessionsPageInfo = { hasMore: false, nextCursor: null };
		exhaustedFallbackSessionCursor = null;
		checkpoints = [];
		cronjobs = [];
		tasks = [];
		loadingSessions = false;
		loadingSessionsSpaceId = null;
		loadingCheckpoints = false;
		loadingCheckpointsSpaceId = null;
		loadingCronjobs = false;
		loadingCronjobsSpaceId = null;
		loadingTasks = false;
		loadingTasksSpaceId = null;
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
</script>

{#snippet sidebarEmptyState(message: string, loading = false)}
	<div class="flex min-h-8 items-center gap-2 rounded-[6px] px-2 py-2 text-[12px] text-text-placeholder">
		{#if loading}
			<Loader2 class="h-3 w-3 animate-spin text-text-tertiary" />
		{/if}
		<span>{message}</span>
	</div>
{/snippet}

{#snippet pinnedFlyoutList()}
	{#if pinnedMarks.length === 0}
		{@render sidebarEmptyState("No pinned items")}
	{:else}
		<div class="space-y-[2px]">
			{#each pinnedMarks.slice(0, sidebarFlyoutPreviewLimit) as mark (mark.id)}
				{@const Icon = getPinnedIcon(mark.resourceType)}
				{@const isActivePinned = isPinnedMarkActive(mark)}
				{@const insertReference = getPinnedInsertReference(mark)}
				<div
					role="link"
					tabindex="0"
					class="sidebar-flyout-item group/pinned relative flex w-full cursor-pointer items-center gap-2 overflow-hidden rounded-[6px] px-2 py-1.5 pr-4 text-left text-[13px] {insertReference ? 'hover:pr-16 focus-within:pr-16' : 'hover:pr-10 focus-within:pr-10'} {isActivePinned ? 'bg-bg-active font-medium text-text-primary' : 'text-text-tertiary hover:bg-bg-hover hover:text-text-secondary'}"
					onclick={() => void handleNavigateToPinned(mark)}
					onkeydown={(e) => {
						if (e.key !== 'Enter' && e.key !== ' ') return;
						e.preventDefault();
						void handleNavigateToPinned(mark);
					}}
					title={mark.resource?.subtitle ?? mark.resourceRef}
					aria-current={isActivePinned ? "page" : undefined}
				>
					<Icon class="h-3.5 w-3.5 shrink-0 {isActivePinned ? 'text-text-tertiary' : 'text-text-placeholder'}" />
					<span class="min-w-0 flex-1 truncate leading-tight">{getPinnedFallbackTitle(mark)}</span>
					<span class="absolute right-1 top-1/2 inline-flex -translate-y-1/2 items-center gap-0.5 opacity-0 pointer-events-none transition-opacity group-hover/pinned:opacity-100 group-hover/pinned:pointer-events-auto group-focus-within/pinned:opacity-100 group-focus-within/pinned:pointer-events-auto">
						{#if insertReference}
							<span
								role="button"
								tabindex="0"
								class="rounded p-0.5 text-text-tertiary transition-colors hover:bg-bg-hover-strong hover:text-text-primary"
								title="Insert"
								onclick={(e) => {
									e.preventDefault();
									e.stopPropagation();
									insertPathReference(insertReference);
								}}
								onkeydown={(e) => {
									if (e.key !== 'Enter' && e.key !== ' ') return;
									e.preventDefault();
									e.stopPropagation();
									insertPathReference(insertReference);
								}}
							>
								<FileText class="h-3.5 w-3.5" />
							</span>
						{/if}
						<span
							role="button"
							tabindex="0"
							class="rounded p-0.5 text-text-tertiary transition-colors hover:bg-bg-hover-strong hover:text-text-primary"
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
							<PinOff class="h-3.5 w-3.5" />
						</span>
					</span>
				</div>
			{/each}
		</div>
	{/if}
{/snippet}

{#snippet sessionsFlyoutList()}
	{#if loadingSessions && sessions.length === 0}
		{@render sidebarEmptyState("Loading chats…", true)}
	{:else if sessions.length === 0}
		{@render sidebarEmptyState("No chats")}
	{:else}
		<div class="space-y-[2px]">
			{#each sidebarSessionItems.slice(0, sidebarFlyoutPreviewLimit) as item (item.session.id)}
				{@const session = item.session}
				{@const isActive = currentPath === buildSpaceSessionRoute(currentSpaceId!, session.id)}
				<a
					href={buildSpaceSessionRoute(currentSpaceId!, session.id)}
					class="sidebar-flyout-item group/session relative flex items-center gap-1.5 overflow-hidden rounded-[6px] px-2 py-1.5 pr-4 text-[13px] hover:pr-20 focus-within:pr-20 {item.isFork ? 'session-fork-row' : ''} {item.isLastVisibleChild ? 'session-fork-row--last' : ''} {isActive ? 'bg-bg-active font-medium text-text-primary' : 'text-text-tertiary hover:bg-bg-hover hover:text-text-secondary'}"
					style={getSessionRowStyle(item)}
					onclick={(e) => { e.preventDefault(); handleNavigateToSession(session.id); }}
					draggable="true"
					ondragstart={(e) => {
						e.dataTransfer?.setData("text/cohub-path", `/sessions/${session.id}.jsonl`);
						if (e.dataTransfer) e.dataTransfer.effectAllowed = "copy";
					}}
					title={item.titleText || sourceTooltip(session.source) || undefined}
					aria-label={item.ariaLabel}
				>
					<SessionSidebarRowContent {session} title={item.displayTitle} />
					<span class="absolute right-1 top-1/2 inline-flex -translate-y-1/2 items-center gap-0.5 opacity-0 pointer-events-none transition-opacity group-hover/session:opacity-100 group-hover/session:pointer-events-auto group-focus-within/session:opacity-100 group-focus-within/session:pointer-events-auto">
						<button type="button" class="rounded p-0.5 text-text-tertiary transition-colors hover:bg-bg-hover-strong hover:text-text-primary" draggable="false" title="Insert" onclick={(e) => { e.preventDefault(); e.stopPropagation(); insertPathReference(`/sessions/${session.id}.jsonl`); }}>
							<FileText class="h-3.5 w-3.5" />
						</button>
						<button type="button" class="rounded p-0.5 text-text-tertiary transition-colors hover:bg-bg-hover-strong hover:text-text-primary" draggable="false" title={isPinned("session", session.id) ? "Unpin chat" : "Pin chat"} onclick={(e) => { e.preventDefault(); e.stopPropagation(); togglePinResource("session", session.id, item.displayTitle); }}>
							{#if isPinned("session", session.id)}<PinOff class="h-3.5 w-3.5" />{:else}<Pin class="h-3.5 w-3.5" />{/if}
						</button>
						<button type="button" class="rounded p-0.5 text-text-tertiary transition-colors hover:bg-bg-hover-strong hover:text-text-primary" draggable="false" title="Rename" onclick={(e) => { e.preventDefault(); e.stopPropagation(); startRenameSession(session); }}>
							<Pencil class="h-3.5 w-3.5" />
						</button>
					</span>
				</a>
			{/each}
			{#if shouldShowLoadMoreSessions()}
				<button type="button" class="mt-1 flex w-full items-center justify-center gap-2 rounded-[6px] px-2 py-1.5 text-[12px] text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-secondary disabled:opacity-60" disabled={loadingMoreSessions} onclick={() => currentSpaceId && void loadMoreSessionsForSpace(currentSpaceId)}>
					{#if loadingMoreSessions}<Loader2 class="h-3 w-3 animate-spin" /> Loading...{:else}Load more{/if}
				</button>
			{/if}
		</div>
	{/if}
{/snippet}

{#snippet checkpointsFlyoutList()}
	{#if loadingCheckpoints && checkpoints.length === 0}
		{@render sidebarEmptyState("Loading saves…", true)}
	{:else if checkpoints.length === 0}
		{@render sidebarEmptyState("No saves")}
	{:else}
		<div class="space-y-[2px]">
			{#each checkpoints.slice(0, sidebarFlyoutPreviewLimit) as checkpoint (checkpoint.id)}
				{@const isActive = activeCheckpointId === checkpoint.id}
				<a href={buildSpaceCheckpointRoute(currentSpaceId!, checkpoint.id)} class="sidebar-flyout-item group/checkpoint relative flex items-center gap-2 overflow-hidden rounded-[6px] px-2 py-1.5 pr-4 text-[13px] hover:pr-12 focus-within:pr-12 {isActive ? 'bg-bg-active font-medium text-text-primary' : 'text-text-tertiary hover:bg-bg-hover hover:text-text-secondary'}" onclick={(e) => { e.preventDefault(); handleNavigateToCheckpoint(checkpoint.id); }}>
					<History class="h-3.5 w-3.5 shrink-0 text-text-placeholder" />
					<div class="min-w-0 flex-1"><div class="truncate leading-tight">{getCheckpointTitle(checkpoint)}</div><div class="mt-0.5 font-mono text-[10px] text-text-placeholder">{checkpoint.commitHash.slice(0, 12)}</div></div>
					<button type="button" class="absolute right-1 top-1/2 inline-flex -translate-y-1/2 rounded p-0.5 text-text-tertiary opacity-0 pointer-events-none transition-opacity hover:bg-bg-hover-strong hover:text-text-primary group-hover/checkpoint:opacity-100 group-hover/checkpoint:pointer-events-auto group-focus-within/checkpoint:opacity-100 group-focus-within/checkpoint:pointer-events-auto" draggable="false" title={isPinned("checkpoint", checkpoint.id) ? "Unpin save" : "Pin save"} onclick={(e) => { e.preventDefault(); e.stopPropagation(); togglePinResource("checkpoint", checkpoint.id, getCheckpointTitle(checkpoint)); }}>
						{#if isPinned("checkpoint", checkpoint.id)}<PinOff class="h-3.5 w-3.5" />{:else}<Pin class="h-3.5 w-3.5" />{/if}
					</button>
				</a>
			{/each}
		</div>
	{/if}
{/snippet}

{#snippet cronjobsFlyoutList()}
	<div class="mb-1 flex justify-end">
		<button type="button" class="inline-flex items-center gap-1 rounded-[5px] px-2 py-1 text-[11px] font-medium text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/35" onclick={handleNavigateToNewCronjob}>
			<Plus class="h-3 w-3" /> New scheduled
		</button>
	</div>
	{#if loadingCronjobs && cronjobs.length === 0}
		{@render sidebarEmptyState("Loading scheduled…", true)}
	{:else if cronjobs.length === 0}
		{@render sidebarEmptyState("No scheduled")}
	{:else}
		<div class="space-y-[2px]">
			{#each cronjobs.slice(0, sidebarFlyoutPreviewLimit) as job (job.id)}
				{@const isActive = activeCronjobId === job.id}
				<a href={buildSpaceCronjobRoute(currentSpaceId!, job.id)} class="sidebar-flyout-item flex items-center gap-2 rounded-[6px] px-2 py-1.5 text-[13px] {isActive ? 'bg-bg-active font-medium text-text-primary' : 'text-text-tertiary hover:bg-bg-hover hover:text-text-secondary'}" onclick={(e) => { e.preventDefault(); handleNavigateToCronjob(job.id); }}>
					<Clock class="h-3.5 w-3.5 shrink-0 text-text-placeholder" />
					<div class="min-w-0 flex-1"><div class="truncate leading-tight">{job.title}</div></div>
					<span class="h-1.5 w-1.5 shrink-0 rounded-full {job.enabled ? 'bg-status-running' : 'bg-text-placeholder'}"></span>
				</a>
			{/each}
		</div>
	{/if}
{/snippet}

{#snippet tasksFlyoutList()}
	{#if loadingTasks && tasks.length === 0}
		{@render sidebarEmptyState("Loading tasks…", true)}
	{:else if tasks.length === 0}
		{@render sidebarEmptyState("No tasks")}
	{:else}
		<div class="space-y-[2px]">
			{#each tasks.slice(0, sidebarFlyoutPreviewLimit) as run (run.id)}
				{@const isActive = activeTaskId === run.id}
				{@const badge = getTaskRunBadge(run.status)}
				<a href={buildSpaceTaskRoute(currentSpaceId!, run.id)} class="sidebar-flyout-item flex items-center gap-2 rounded-[6px] px-2 py-1.5 text-[13px] {isActive ? 'bg-bg-active font-medium text-text-primary' : 'text-text-tertiary hover:bg-bg-hover hover:text-text-secondary'}" onclick={(e) => { e.preventDefault(); handleNavigateToTask(run.id); }}>
					<Activity class="h-3.5 w-3.5 shrink-0 text-text-placeholder" />
					<div class="min-w-0 flex-1"><div class="truncate text-[12px] capitalize leading-tight {badge.color}">{run.status}</div><div class="mt-0.5 text-[10px] text-text-placeholder">{formatTaskRunTime(run)}</div></div>
					<span class="h-1.5 w-1.5 shrink-0 rounded-full {badge.dot}"></span>
				</a>
			{/each}
		</div>
	{/if}
{/snippet}

{#if collapsed && !isMobile}
  <aside class="h-screen w-[52px] shrink-0 bg-bg-primary">
    <div class="flex h-full flex-col items-center border-r border-border-subtle/70 px-2 py-2">
      <a
        href="/"
        class="flex h-8 w-8 shrink-0 items-center justify-center rounded-[7px] bg-brand text-[11px] font-bold text-brand-contrast-fg transition-colors duration-100 hover:bg-brand-hover"
        aria-label="Cohub home"
        title="Home"
      >
        C
      </a>
      <button
        type="button"
        class="mt-1 flex h-8 w-8 items-center justify-center rounded-[6px] text-text-tertiary transition-colors duration-100 hover:bg-bg-hover hover:text-text-secondary"
        onclick={() => uiState.setLeftSidebarCollapsed(false)}
        aria-label="Expand sidebar"
        title="Expand sidebar"
      >
        <PanelLeftOpen class="h-4 w-4" />
      </button>
      <button
        type="button"
        class="mt-1 flex h-8 w-8 items-center justify-center rounded-[6px] text-text-tertiary transition-colors duration-100 hover:bg-bg-hover hover:text-text-secondary"
        onclick={openCommandPalette}
        aria-label="Search everywhere"
        title="Search everywhere (⌘K / Ctrl K)"
      >
        <Search class="h-4 w-4" />
      </button>

      <div class="mt-2 h-px w-6 bg-border-subtle/70"></div>

      {#if mode === "space"}
        <div class="mt-2 flex w-full flex-col items-center gap-1">
          <button
            type="button"
            class="flex h-8 w-8 items-center justify-center overflow-hidden rounded-[6px] text-text-tertiary transition-colors duration-100 hover:bg-bg-hover hover:text-text-secondary"
            onclick={openSpacePalette}
            aria-label={currentSpace ? `Switch space: ${currentSpace.name || currentSpace.title || currentSpace.id}` : "Select a space"}
            title={currentSpace ? currentSpace.name || currentSpace.title || currentSpace.id : "Select a space"}
          >
            {#if currentSpace}
              <SpaceAvatar name={currentSpace.name || currentSpace.title || currentSpace.id} profile={currentSpace.publicProfile} size="sm" />
            {:else}
              <FolderKanban class="h-4 w-4" />
            {/if}
          </button>
          {#if currentSpace}
            <button
              type="button"
              class="relative flex h-8 w-8 items-center justify-center rounded-[6px] text-brand transition-colors duration-100 hover:bg-brand-muted hover:text-brand"
              onclick={() => { void handleCreateNewSession(); }}
              disabled={creatingSession}
              aria-label="New chat"
              title="New chat (⌘O / Ctrl O)"
            >
              {#if creatingSession}
                <Loader2 class="h-4 w-4 animate-spin" />
              {:else}
                <Plus class="h-4 w-4" />
              {/if}
            </button>
            <button
              type="button"
              class="flex h-8 w-8 items-center justify-center rounded-[6px] transition-colors duration-100 {currentPath === buildSpaceDetailRoute(currentSpaceId!) ? 'bg-bg-active text-text-primary' : 'text-text-tertiary hover:bg-bg-hover hover:text-text-secondary'}"
              onclick={() => { void handleNavigate(buildSpaceDetailRoute(currentSpaceId!)); }}
              aria-label="Space details"
              title="Space details"
            >
              <LayoutDashboard class="h-4 w-4" />
            </button>
            <button
              type="button"
              class="flex h-8 w-8 items-center justify-center rounded-[6px] text-text-tertiary transition-colors duration-100 hover:bg-bg-hover hover:text-text-secondary"
              onclick={handleNavigateToNewCheckpoint}
              aria-label="New save"
              title="New save"
            >
              <Save class="h-4 w-4" />
            </button>
          {/if}
        </div>

        {#if currentSpace}
          <div class="mt-2 h-px w-6 bg-border-subtle/70"></div>
          <nav class="mt-2 flex w-full flex-1 flex-col items-center gap-1 overflow-visible">
            <SidebarFlyout label="Pinned" active={pinnedMarks.some(isPinnedMarkActive)} onTriggerClick={() => uiState.setLeftSidebarCollapsed(false)}>
              {#snippet trigger()}
                <Pin class="h-4 w-4" />
              {/snippet}
              {@render pinnedFlyoutList()}
            </SidebarFlyout>
            <SidebarFlyout label="Chats" active={Boolean(activeSession)} onTriggerClick={() => uiState.setLeftSidebarCollapsed(false)}>
              {#snippet trigger()}
                <NotebookPen class="h-4 w-4" />
                {#if activeSession && unreadTracker.isUnread(activeSession, activeSession.lastMessageId)}
                  <span class="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-brand"></span>
                {/if}
              {/snippet}
              {@render sessionsFlyoutList()}
            </SidebarFlyout>
            <SidebarFlyout label="Saves" active={Boolean(activeCheckpointId)} onTriggerClick={() => uiState.setLeftSidebarCollapsed(false)}>
              {#snippet trigger()}
                <History class="h-4 w-4" />
              {/snippet}
              {@render checkpointsFlyoutList()}
            </SidebarFlyout>
            <SidebarFlyout label="Scheduled" active={Boolean(activeCronjobId)} onTriggerClick={() => uiState.setLeftSidebarCollapsed(false)}>
              {#snippet trigger()}
                <Clock class="h-4 w-4" />
              {/snippet}
              {@render cronjobsFlyoutList()}
            </SidebarFlyout>
            <SidebarFlyout label="Tasks" active={Boolean(activeTaskId)} onTriggerClick={() => uiState.setLeftSidebarCollapsed(false)}>
              {#snippet trigger()}
                <Activity class="h-4 w-4" />
              {/snippet}
              {@render tasksFlyoutList()}
            </SidebarFlyout>
          </nav>
        {:else}
          <div class="flex-1"></div>
        {/if}
      {:else}
        <nav class="mt-3 flex w-full flex-1 flex-col items-center gap-1 overflow-y-auto">
          <button type="button" class="rail-button text-text-tertiary" onclick={returnFromSettings} aria-label="Back" title="Back">
            <ArrowLeft class="h-4 w-4" />
          </button>
          {#each settingsTabs as tab (tab.id)}
            {@const isActive = activeSettingsTab === tab.id}
            <a
              href={tab.href}
              class="rail-button {isActive ? 'bg-bg-active text-text-primary' : 'text-text-tertiary'}"
              title={tab.label}
              aria-label={tab.label}
              onclick={(e) => { e.preventDefault(); handleNavigate(tab.href, { keepSettingsReturn: true }); }}
            >
              <tab.icon class="h-4 w-4" />
            </a>
          {/each}
        </nav>
      {/if}

      <div class="relative mt-auto w-full pt-2">
        {#if showUserMenu}
          <div data-user-menu class="absolute bottom-full left-0 z-50 mb-1 w-56 overflow-hidden rounded-md border border-border-subtle bg-bg-primary py-1 shadow-lg">
            <div class="border-b border-border-subtle pb-1">
              <div class="rail-menu-item" title="Net balance">
                <CreditCard class="h-3.5 w-3.5" />
                <span>Balance</span>
                <span class="ml-auto font-mono text-[11px] {billingCredit && billingCredit.balance.netUsd < 0 ? 'text-error-soft' : 'text-text-secondary'}">
                  {#if billingCreditLoading || (!billingCredit && !billingCreditError)}
                    <Loader2 class="h-3.5 w-3.5 animate-spin text-text-tertiary" />
                  {:else if billingCredit}
                    {formatUsdAmount(billingCredit.balance.netUsd)}
                  {:else}
                    <span class="text-text-placeholder">—</span>
                  {/if}
                </span>
              </div>
              {#if billingCreditError}
                <div class="px-2.5 pb-1 text-[11px] text-text-placeholder">{billingCreditError}</div>
              {/if}
            </div>
            {#if mode === "space"}
              <a href="/settings" class="rail-menu-item" onclick={(e) => { e.preventDefault(); openSettings(); }}><Settings class="h-3.5 w-3.5" /><span>Settings</span></a>
            {:else}
              <a href="/" class="rail-menu-item" onclick={(e) => { e.preventDefault(); showUserMenu = false; handleNavigate('/'); }}><FolderKanban class="h-3.5 w-3.5" /><span>Spaces</span></a>
            {/if}
            <a href="/explore?view=wall" class="rail-menu-item" onclick={(e) => { e.preventDefault(); showUserMenu = false; handleNavigate('/explore?view=wall'); }}><Compass class="h-3.5 w-3.5" /><span>Explore Wall</span></a>
            <a href="/trending" class="rail-menu-item" onclick={(e) => { e.preventDefault(); showUserMenu = false; handleNavigate('/trending'); }}><BarChart3 class="h-3.5 w-3.5" /><span>Trending</span></a>
            <button type="button" class="rail-menu-item w-full" onclick={openHelpPanel}><Keyboard class="h-3.5 w-3.5" /><span>Help</span></button>
            <button type="button" class="rail-menu-item w-full" onclick={saveDebugLog}><Download class="h-3.5 w-3.5" /><span>Save debug log</span></button>
            <button type="button" class="rail-menu-item w-full hover:text-error-soft" onclick={() => { showUserMenu = false; void handleLogout(); }}><LogOut class="h-3.5 w-3.5" /><span>Sign out</span></button>
          </div>
        {/if}
        <button
          type="button"
          data-user-menu
          class="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full bg-bg-hover-strong transition-colors duration-100 hover:bg-bg-hover"
          onclick={() => { showUserMenu = !showUserMenu; }}
          aria-label={userDisplayName}
          title={userDisplayName}
        >
          {#if authStore.profile?.avatarUrl}
            <img src={authStore.profile.avatarUrl} alt="" class="h-full w-full object-cover" />
          {:else}
            <User class="h-4 w-4 text-text-tertiary" />
          {/if}
        </button>
      </div>
    </div>
  </aside>
{:else}
<aside class="{isMobile ? 'h-full' : 'shrink-0 h-screen'} flex flex-col bg-bg-primary">
  <!-- Brand Header -->
  <div class="flex h-[48px] shrink-0 items-center justify-between gap-2 border-b border-border-subtle px-3">
    <a href="/" class="flex min-w-0 items-center gap-2 group" aria-label="Cohub">
      <div class="w-7 h-7 bg-brand rounded-[6px] flex items-center justify-center font-bold text-[11px] text-brand-contrast-fg group-hover:bg-brand-hover transition-colors shrink-0">
        C
      </div>
      <span class="font-semibold text-[13px] text-text-primary tracking-tight truncate">Cohub</span>
    </a>
    <div class="flex shrink-0 items-center gap-1">
      <button
        type="button"
        class="group/search flex h-7 shrink-0 items-center gap-1.5 rounded-[6px] bg-bg-surface px-2 text-[11px] text-text-tertiary transition-colors duration-100 hover:bg-bg-hover hover:text-text-secondary"
        onclick={openCommandPalette}
        title="Search everywhere (⌘K / Ctrl K)"
        aria-label="Search everywhere"
      >
        <Search class="h-3.5 w-3.5 text-text-placeholder transition-colors group-hover/search:text-brand" />
        <span class="hidden font-mono tracking-[0.02em] sm:inline">⌘K</span>
      </button>
      {#if !isMobile}
        <button
          type="button"
          class="flex h-7 w-7 shrink-0 items-center justify-center rounded-[5px] text-text-tertiary transition-colors duration-100 hover:bg-bg-hover hover:text-text-secondary"
          onclick={() => uiState.setLeftSidebarCollapsed(true)}
          title="Collapse sidebar"
          aria-label="Collapse sidebar"
        >
          <PanelLeftClose class="h-4 w-4" />
        </button>
      {/if}
    </div>
  </div>

  {#if mode === "space"}
    <!-- Space Switcher -->
    <div class="px-1.5 py-1 shrink-0 border-b border-border-subtle">
      <button
        type="button"
        class="w-full flex items-center gap-1.5 px-1.5 py-1.5 rounded-[5px] hover:bg-bg-hover transition-colors duration-100 cursor-pointer group"
        onclick={openSpacePalette}
      >
        {#if currentSpace}
          <SpaceAvatar name={currentSpace.name || currentSpace.title || currentSpace.id} profile={currentSpace.publicProfile} size="sm" />
          <span class="flex-1 text-[13px] font-medium text-text-primary truncate text-left">{currentSpace.name || currentSpace.title || currentSpace.id.slice(0, 12)}</span>
        {:else}
          <span class="flex-1 text-[13px] text-text-placeholder truncate text-left">Select a space</span>
        {/if}
        <ChevronDown class="w-3.5 h-3.5 text-text-tertiary shrink-0 transition-transform duration-150 group-hover:text-text-secondary" />
      </button>
    </div>

    <!-- Action Buttons -->
    {#if currentSpace}
      <div class="px-1.5 py-1.5 shrink-0 space-y-[2px]">
        <button
          type="button"
          class="flex w-full items-center gap-2 rounded-[7px] border border-brand-border bg-brand-muted px-1.5 py-1.5 text-brand transition-colors duration-100 hover:bg-brand-muted-hover disabled:cursor-not-allowed disabled:opacity-50"
          onclick={() => { void handleCreateNewSession(); }}
          disabled={creatingSession}
          title="New chat (⌘O / Ctrl O)"
          aria-label="New chat (⌘O / Ctrl O)"
        >
          {#if creatingSession}
            <Loader2 class="w-3.5 h-3.5 animate-spin shrink-0" />
            <span class="text-[12px] font-medium">Creating…</span>
          {:else}
            <Plus class="w-3.5 h-3.5 shrink-0" />
            <span class="text-[12px] font-medium">New Chat</span>
            <span class="ml-auto hidden rounded-[4px] border border-brand/20 bg-bg-primary/70 px-1.5 py-px font-mono text-[10px] text-brand/80 xl:inline">⌘O</span>
          {/if}
        </button>
        <button
          type="button"
          class="flex items-center gap-2 w-full px-1.5 py-1.5 rounded-[5px] text-text-tertiary hover:text-text-primary hover:bg-bg-hover transition-colors duration-100 disabled:opacity-50"
          onclick={() => { void handleNavigate(buildSpaceDetailRoute(currentSpaceId!)); }}
          title="Space details"
        >
          <LayoutDashboard class="w-3.5 h-3.5 shrink-0" />
          <span class="text-[12px] font-medium">Detail</span>
        </button>
        <button
          type="button"
          class="flex items-center gap-2 w-full px-1.5 py-1.5 rounded-[5px] text-text-tertiary hover:text-text-primary hover:bg-bg-hover transition-colors duration-100 disabled:opacity-50"
          onclick={handleNavigateToNewCheckpoint}
          title="New save"
        >
          <Save class="w-3.5 h-3.5 shrink-0" />
          <span class="text-[12px] font-medium">New Save</span>
        </button>
        {#if createSessionError}
          <div class="px-2 py-1 text-[11px] text-error-soft">{createSessionError}</div>
        {/if}
      </div>
    {/if}

    <!-- Sessions / Checkpoints -->
    {#if currentSpace}
      <div class="flex-1 overflow-y-auto px-1.5 pb-2 pt-1 min-h-0">
        {#if loadingSessions && sessions.length === 0 && loadingCheckpoints && checkpoints.length === 0}
          <div class="px-1 py-4 text-[12px] text-text-tertiary text-center flex items-center justify-center gap-2">
            <Loader2 class="w-3 h-3 animate-spin" />
            Loading...
          </div>
        {:else}
          {#if pinnedMarks.length > 0}
            <div class="mb-3">
              <div class="flex items-center gap-2 px-1.5 py-1.5 w-full text-left rounded-[6px]">
                <Pin class="w-3 h-3 text-text-tertiary shrink-0" />
                <span class="text-[11px] text-text-placeholder select-none">Pinned</span>
              </div>
              <div class="space-y-[2px] mt-1">
                {#each pinnedMarks as mark (mark.id)}
                  {@const Icon = getPinnedIcon(mark.resourceType)}
                  {@const isActivePinned = isPinnedMarkActive(mark)}
                  {@const insertReference = getPinnedInsertReference(mark)}
                  <button
                    type="button"
                    class="group/pinned relative flex items-center gap-2 w-full overflow-hidden px-1.5 py-1.5 pr-4 {insertReference ? 'hover:pr-16 focus-within:pr-16' : 'hover:pr-10 focus-within:pr-10'} rounded-[6px] text-left text-[13px] transition-colors duration-100 {isActivePinned ? 'text-text-primary bg-bg-active font-medium' : 'text-text-tertiary hover:text-text-secondary hover:bg-bg-hover'}"
                    onclick={() => void handleNavigateToPinned(mark)}
                    title={mark.resource?.subtitle ?? mark.resourceRef}
                    aria-current={isActivePinned ? "page" : undefined}
                  >
                    <Icon class="w-3.5 h-3.5 shrink-0 {isActivePinned ? 'text-text-tertiary' : 'text-text-placeholder'}" />
                    <span class="truncate leading-tight flex-1">{getPinnedFallbackTitle(mark)}</span>
                    <span class={isMobile ? "hidden" : "absolute right-1 top-1/2 -translate-y-1/2 inline-flex items-center gap-0.5 opacity-0 pointer-events-none transition-opacity group-hover/pinned:opacity-100 group-hover/pinned:pointer-events-auto group-focus-within/pinned:opacity-100 group-focus-within/pinned:pointer-events-auto"}>
                      {#if insertReference}
                        <span
                          role="button"
                          tabindex="0"
                          class="p-0.5 rounded text-text-tertiary hover:text-text-primary hover:bg-bg-hover-strong transition-colors"
                          title="Insert"
                          onclick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            insertPathReference(insertReference);
                          }}
                          onkeydown={(e) => {
                            if (e.key !== 'Enter' && e.key !== ' ') return;
                            e.preventDefault();
                            e.stopPropagation();
                            insertPathReference(insertReference);
                          }}
                        >
                          <FileText class="w-3.5 h-3.5" />
                        </span>
                      {/if}
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
            class="flex items-center gap-2 px-1.5 py-1.5 w-full text-left hover:bg-bg-hover transition-colors duration-100 rounded-[6px]"
            onclick={() => { sessionsCollapsed = !sessionsCollapsed; }}
            title={sessionsCollapsed ? "Expand chats" : "Collapse chats"}
          >
            <ChevronDown class="w-3 h-3 text-text-tertiary shrink-0 transition-transform duration-150 {sessionsCollapsed ? 'rotate-180' : ''}" />
            <span class="text-[11px] text-text-placeholder select-none">Chats</span>
          </button>

          {#if !sessionsCollapsed}
            {#if sessions.length === 0}
              <div class="px-1.5 py-2 text-[12px] text-text-placeholder">No chats</div>
            {:else}
              <div class="space-y-[2px] mt-1">
                {#each sidebarSessionItems as item, index (item.session.id)}
                  {@const session = item.session}
                  {@const isActive = currentPath === buildSpaceSessionRoute(currentSpaceId!, session.id)}
                  {@const isRenaming = renamingSessionId === session.id}

                  {#if isRenaming}
                    <!-- Inline rename input -->
                    <div class="flex items-center gap-1 px-1.5 py-1 rounded-[6px] bg-bg-active">
                      <input
                        bind:this={renameInputElement}
                        bind:value={renameTitleValue}
                        type="text"
                        class="flex-1 min-w-0 bg-transparent text-[13px] text-text-primary outline-none leading-tight"
                        placeholder="Session name"
                        maxlength={80}
                        disabled={renameSaving}
                        onkeydown={(e) => {
                          if (
                            e.key === "Enter" &&
                            !renameSaving &&
                            !isComposingKeyboardEvent(e)
                          ) {
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
                      class="group/session relative flex items-center gap-1.5 overflow-hidden px-1.5 py-1.5 pr-4 rounded-[6px] text-[13px] transition-colors duration-100 hover:pr-20 focus-within:pr-20 {item.isFork ? 'session-fork-row' : ''} {item.isLastVisibleChild ? 'session-fork-row--last' : ''} {isActive ? 'text-text-primary bg-bg-active font-medium' : 'text-text-tertiary hover:text-text-secondary hover:bg-bg-hover'}"
                      style={getSessionRowStyle(item)}
						onclick={(e) => { e.preventDefault(); handleNavigateToSession(session.id); }}
							draggable={!isMobile}
								ondragstart={(e) => {
									e.dataTransfer?.setData(
										"text/cohub-path",
										`/sessions/${session.id}.jsonl`,
									);
									if (e.dataTransfer) e.dataTransfer.effectAllowed = "copy";
								}}
                      title={item.titleText || sourceTooltip(session.source) || undefined}
                      aria-label={item.ariaLabel}
                    >
                      <SessionSidebarRowContent {session} title={item.displayTitle} {isMobile} />
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
                            togglePinResource("session", session.id, item.displayTitle);
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
                    class="mt-1 flex items-center justify-center gap-2 w-full px-1.5 py-1.5 rounded-[6px] text-[12px] text-text-tertiary hover:text-text-secondary hover:bg-bg-hover transition-colors duration-100 disabled:opacity-60"
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
              <div class="flex items-center gap-1 px-1.5 py-1 mt-1 rounded-[6px] bg-bg-active">
                <input
                  bind:this={renameInputElement}
                  bind:value={renameTitleValue}
                  type="text"
                  class="flex-1 min-w-0 bg-transparent text-[13px] text-text-primary outline-none leading-tight"
                  placeholder="Session name"
                  maxlength={80}
                  disabled={renameSaving}
                  onkeydown={(e) => {
                    if (
                      e.key === "Enter" &&
                      !renameSaving &&
                      !isComposingKeyboardEvent(e)
                    ) {
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
                class="group/session relative flex items-center gap-1.5 overflow-hidden px-1.5 py-1.5 pr-4 mt-1 rounded-[6px] text-[13px] transition-colors duration-100 hover:pr-20 focus-within:pr-20 text-text-primary bg-bg-active font-medium"
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
                <SessionSidebarRowContent session={activeSession} title={getSessionTitle(activeSession, 0)} {isMobile} />
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
              class="flex items-center gap-2 px-1.5 py-1.5 w-full text-left hover:bg-bg-hover transition-colors duration-100 rounded-[6px]"
              onclick={() => { checkpointsCollapsed = !checkpointsCollapsed; }}
              title={checkpointsCollapsed ? "Expand saves" : "Collapse saves"}
            >
              <ChevronDown class="w-3 h-3 text-text-tertiary shrink-0 transition-transform duration-150 {checkpointsCollapsed ? 'rotate-180' : ''}" />
              <span class="text-[11px] text-text-placeholder select-none">Saves</span>
            </button>

            {#if !checkpointsCollapsed}
              {#if loadingCheckpoints && checkpoints.length === 0}
                <div class="px-1.5 py-2 text-[12px] text-text-tertiary flex items-center gap-2">
                  <Loader2 class="w-3 h-3 animate-spin" />
                  Loading saves...
                </div>
              {:else if checkpoints.length === 0}
                <div class="px-1.5 py-2 text-[12px] text-text-placeholder">No saves</div>
              {:else}
                <div class="space-y-[2px] mt-1">
                  {#each checkpoints.slice(0, 20) as checkpoint (checkpoint.id)}
                    {@const isActive = activeCheckpointId === checkpoint.id}
                    <a
                      href={buildSpaceCheckpointRoute(currentSpaceId!, checkpoint.id)}
                      class="group/checkpoint relative flex items-center gap-2 overflow-hidden px-1.5 py-1.5 pr-4 hover:pr-12 focus-within:pr-12 rounded-[6px] text-[13px] transition-colors duration-100 {isActive ? 'text-text-primary bg-bg-active font-medium' : 'text-text-tertiary hover:text-text-secondary hover:bg-bg-hover'}"
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
                class="flex items-center gap-2 px-1.5 py-1.5 mt-1 rounded-[6px] text-[13px] transition-colors duration-100 text-text-primary bg-bg-active font-medium"
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
              class="flex items-center gap-2 px-1.5 py-1.5 w-full text-left hover:bg-bg-hover transition-colors duration-100 rounded-[6px] cursor-pointer"
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
                <div class="px-1.5 py-2 text-[12px] text-text-tertiary flex items-center gap-2">
                  <Loader2 class="w-3 h-3 animate-spin" />
                  Loading scheduled...
                </div>
              {:else if cronjobs.length === 0}
                <div class="px-1.5 py-2 text-[12px] text-text-placeholder">No scheduled</div>
              {:else}
                <div class="space-y-[2px] mt-1">
                  {#each cronjobs.slice(0, 20) as job (job.id)}
                    {@const isActive = activeCronjobId === job.id}
                    <a
                      href={buildSpaceCronjobRoute(currentSpaceId!, job.id)}
                      class="flex items-center gap-2 px-1.5 py-1.5 rounded-[6px] text-[13px] transition-colors duration-100 {isActive ? 'text-text-primary bg-bg-active font-medium' : 'text-text-tertiary hover:text-text-secondary hover:bg-bg-hover'}"
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
                class="flex items-center gap-2 px-1.5 py-1.5 mt-1 rounded-[6px] text-[13px] transition-colors duration-100 text-text-primary bg-bg-active font-medium"
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
              class="flex items-center gap-2 px-1.5 py-1.5 w-full text-left hover:bg-bg-hover transition-colors duration-100 rounded-[6px]"
              onclick={() => { tasksCollapsed = !tasksCollapsed; }}
              title={tasksCollapsed ? "Expand tasks" : "Collapse tasks"}
            >
              <ChevronDown class="w-3 h-3 text-text-tertiary shrink-0 transition-transform duration-150 {tasksCollapsed ? 'rotate-180' : ''}" />
              <span class="text-[11px] text-text-placeholder select-none">Tasks</span>
            </button>

            {#if !tasksCollapsed}
              {#if loadingTasks && tasks.length === 0}
                <div class="px-1.5 py-2 text-[12px] text-text-tertiary flex items-center gap-2">
                  <Loader2 class="w-3 h-3 animate-spin" />
                  Loading tasks...
                </div>
              {:else if tasks.length === 0}
                <div class="px-1.5 py-2 text-[12px] text-text-placeholder">No tasks</div>
              {:else}
                <div class="space-y-[2px] mt-1">
                  {#each tasks.slice(0, 15) as run (run.id)}
                    {@const isActive = activeTaskId === run.id}
                    {@const badge = getTaskRunBadge(run.status)}
                    <a
                      href={buildSpaceTaskRoute(currentSpaceId!, run.id)}
                      class="flex items-center gap-2 px-1.5 py-1.5 rounded-[6px] text-[13px] transition-colors duration-100 {isActive ? 'text-text-primary bg-bg-active font-medium' : 'text-text-tertiary hover:text-text-secondary hover:bg-bg-hover'}"
                      onclick={(e) => { e.preventDefault(); handleNavigateToTask(run.id); }}
                    >
                      <Activity class="w-3.5 h-3.5 shrink-0 text-text-placeholder" />
                      <div class="min-w-0 flex-1">
                        <div class="truncate leading-tight text-[12px] capitalize {badge.color}">{run.status}</div>
                        <div class="mt-0.5 text-[10px] text-text-placeholder">{formatTaskRunTime(run)}</div>
                      </div>
                      <span class="w-[6px] h-[6px] rounded-full shrink-0 {badge.dot}"></span>
                    </a>
                  {/each}
                </div>
              {/if}
            {:else if activeTaskId}
              <a
                href={buildSpaceTaskRoute(currentSpaceId!, activeTaskId)}
                class="flex items-center gap-2 px-1.5 py-1.5 mt-1 rounded-[6px] text-[13px] transition-colors duration-100 text-text-primary bg-bg-active font-medium"
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
      <div class="flex-1 overflow-y-auto px-1.5 pb-2 pt-1 min-h-0">
        <div class="px-1 py-6 text-[12px] text-text-placeholder text-center">
          Select a space to view chats
        </div>
      </div>
    {/if}
  {:else}
    <div class="px-1.5 pt-2 pb-1">
      <button
        type="button"
        class="flex w-full items-center gap-2 rounded-[5px] px-1.5 py-2 text-[13px] text-text-tertiary transition-colors duration-100 hover:bg-bg-hover hover:text-text-secondary"
        onclick={returnFromSettings}
      >
        <ArrowLeft class="w-[15px] h-[15px] shrink-0" />
        <span class="truncate">Back</span>
      </button>
    </div>
    <nav class="flex-1 overflow-y-auto px-1.5 py-2 space-y-[2px]">
      {#each settingsTabs as tab (tab.id)}
        {@const isActive = activeSettingsTab === tab.id}
        <a
          href={tab.href}
          class="flex items-center gap-2.5 px-1.5 py-2 rounded-[5px] text-[13px] transition-colors duration-100 cursor-pointer {
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
        <div class="border-b border-border-subtle">
          <div
            class="flex w-full items-center gap-2 px-2.5 py-[7px] text-[12px] text-text-tertiary"
            title="Net balance"
          >
            <CreditCard class="w-3.5 h-3.5" />
            <span>Balance</span>
            <span class="ml-auto font-mono text-[11px] {billingCredit && billingCredit.balance.netUsd < 0 ? 'text-error-soft' : 'text-text-secondary'}">
              {#if billingCreditLoading || (!billingCredit && !billingCreditError)}
                <Loader2 class="h-3.5 w-3.5 animate-spin text-text-tertiary" />
              {:else if billingCredit}
                {formatUsdAmount(billingCredit.balance.netUsd)}
              {:else}
                <span class="text-text-placeholder">—</span>
              {/if}
            </span>
          </div>
          {#if billingCreditError}
            <div class="px-2.5 pb-2 text-[11px] text-text-placeholder">{billingCreditError}</div>
          {/if}
        </div>
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
          href="/explore?view=wall"
          class="flex items-center gap-2 px-2.5 py-[7px] text-[12px] text-text-tertiary hover:text-text-secondary hover:bg-bg-hover transition-colors duration-100"
          onclick={(e) => { e.preventDefault(); showUserMenu = false; handleNavigate('/explore?view=wall'); }}
        >
          <Compass class="w-3.5 h-3.5" />
          <span>Explore Wall</span>
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
	          type="button"
	          class="flex items-center gap-2 w-full px-2.5 py-[7px] text-[12px] text-text-tertiary hover:text-text-secondary hover:bg-bg-hover transition-colors duration-100"
	          onclick={openHelpPanel}
        >
          <Keyboard class="w-3.5 h-3.5" />
	          <span>Help</span>
	          <span class="ml-auto rounded-[4px] border border-border-subtle bg-bg-surface px-1.5 py-px font-mono text-[10px] leading-4 text-text-placeholder">?</span>
	        </button>
	        <button
	          type="button"
	          class="flex items-center gap-2 w-full px-2.5 py-[7px] text-[12px] text-text-tertiary hover:text-text-secondary hover:bg-bg-hover transition-colors duration-100"
	          onclick={saveDebugLog}
	        >
	          <Download class="w-3.5 h-3.5" />
	          <span>Save debug log</span>
	        </button>
	        <button
	          type="button"
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
      class="flex items-center gap-2 w-full px-1.5 py-[6px] rounded-[5px] hover:bg-bg-hover transition-colors duration-100 cursor-pointer"
      onclick={() => { showUserMenu = !showUserMenu; }}
    >
      <div class="w-[22px] h-[22px] rounded-full bg-bg-hover-strong overflow-hidden shrink-0">
        {#if authStore.profile?.avatarUrl}
          <img src={authStore.profile.avatarUrl} alt="avatar" class="w-full h-full object-cover" />
        {:else}
          <svg viewBox="0 0 32 32" class="w-full h-full" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect width="32" height="32" rx="16" fill="var(--avatar-placeholder-bg)" />
            <circle cx="16" cy="12" r="5" fill="var(--avatar-placeholder-fg)" />
            <ellipse cx="16" cy="26" rx="9" ry="7" fill="var(--avatar-placeholder-fg)" />
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
{/if}

<style>
	.rail-button {
		position: relative;
		display: flex;
		height: 2rem;
		width: 2rem;
		align-items: center;
		justify-content: center;
		border-radius: 0.375rem;
		transition:
			background-color 100ms ease,
			color 100ms ease;
	}

	.rail-button:hover {
		background: var(--color-bg-hover);
		color: var(--color-text-secondary);
	}

	.rail-menu-item {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.4375rem 0.625rem;
		font-size: 0.75rem;
		color: var(--color-text-tertiary);
		transition:
			background-color 100ms ease,
			color 100ms ease;
	}

	.rail-menu-item:hover {
		background: var(--color-bg-hover);
		color: var(--color-text-secondary);
	}

	.session-fork-row {
		padding-left: calc(0.5rem + var(--fork-indent, 0px));
	}

	.session-fork-row::before {
		content: "";
		position: absolute;
		left: calc(0.45rem + var(--fork-indent, 0px) - 7px);
		top: 50%;
		width: 8px;
		height: 2px;
		border-radius: 999px;
		background: color-mix(
			in oklab,
			var(--color-brand) 34%,
			var(--color-border-subtle)
		);
		opacity: 0.74;
		transform: translateY(-50%);
		pointer-events: none;
	}

	.session-fork-row::after {
		content: "";
		position: absolute;
		left: calc(0.45rem + var(--fork-indent, 0px) - 7px);
		top: 0.35rem;
		bottom: 0.35rem;
		width: 1px;
		background: color-mix(
			in oklab,
			var(--color-brand) 24%,
			var(--color-border-subtle)
		);
		opacity: 0.62;
		pointer-events: none;
	}

	.session-fork-row--last::after {
		bottom: 50%;
	}

	.session-activity-caret {
		display: inline-block;
		margin-left: 0.0625rem;
		color: var(--color-brand);
		font-size: 0.82em;
		line-height: 1;
		animation: session-activity-caret 1.15s steps(2, jump-none) infinite;
	}

	@keyframes session-activity-caret {
		0%,
		45% {
			opacity: 1;
		}
		46%,
		100% {
			opacity: 0.28;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.session-activity-caret {
			animation: none;
			opacity: 0.85;
		}
	}

	@media (hover: hover) {
		.session-fork-row:hover::before,
		.session-fork-row:focus-within::before {
			opacity: 0.95;
			background: color-mix(
				in oklab,
				var(--color-brand) 48%,
				var(--color-text-placeholder)
			);
		}
	}

	@media (max-width: 640px) {
		.session-fork-row {
			padding-left: calc(0.5rem + min(var(--fork-indent, 0px), 10px));
		}

		.session-fork-row::before,
		.session-fork-row::after {
			left: calc(0.45rem + min(var(--fork-indent, 0px), 10px) - 7px);
		}
	}
</style>
