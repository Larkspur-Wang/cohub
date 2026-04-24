<script lang="ts">
import {
	type CheckpointRecord,
	type CronJobRecord,
	HttpError,
	type SessionRecord,
	type SpaceRecord,
	type TaskRunRecord,
} from "@neta-art/cohub";
import {
	Activity,
	ChevronDown,
	Clock,
	FolderKanban,
	History,
	KeyRound,
	LayoutDashboard,
	Loader2,
	LogOut,
	Network,
	Palette,
	Plus,
	Settings,
	User,
	Users,
} from "lucide-svelte";
import { onMount, untrack } from "svelte";
import { goto } from "$app/navigation";
import { page } from "$app/state";
import { logtoClient } from "$lib/auth";
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
import {
	clearAllCachedSessionLists,
	fetchSessionListWithCache,
	getCachedSessionList,
	getCachedSessionListMeta,
	onSessionListCacheUpdated,
	patchCachedSessionList,
} from "$lib/stores/session-list-cache";
import { isStreaming, unreadTracker } from "$lib/stores/session-state.svelte";
import {
	clearAllCachedSpaceLists,
	fetchSpaceListWithCache,
	getCachedSpaceList,
	getCachedSpaceListMeta,
	onSpaceListCacheUpdated,
} from "$lib/stores/space-list-cache";

const {
	isMobile = false,
	onClose,
	mode = "space",
}: {
	isMobile?: boolean;
	onClose?: () => void;
	mode?: "space" | "settings";
} = $props();

let isLoading = $state(true);
let loadError = $state("");
let showUserMenu = $state(false);
let showSpaceModal = $state(false);
let spaces = $state<SpaceRecord[]>([]);
let sessions = $state<SessionRecord[]>([]);
let checkpoints = $state<CheckpointRecord[]>([]);
let loadingSessions = $state(false);
let loadingCheckpoints = $state(false);

let sessionsCollapsed = $state(false);
let checkpointsCollapsed = $state(false);
let cronjobsCollapsed = $state(false);
let tasksCollapsed = $state(false);
let creatingSession = $state(false);
let createSessionError = $state("");

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

let streamingSessionIds = $state<Set<string>>(new Set());

const currentSpaceId = $derived.by(() => {
	const match = currentPath.match(/^\/spaces\/([^/]+)/);
	const id = match?.[1] ?? null;
	if (id === "new") return null;
	return id;
});

const currentSpace = $derived(
	currentSpaceId ? (spaces.find((s) => s.id === currentSpaceId) ?? null) : null,
);

const settingsTabs = [
	{ id: "profile", label: "Profile", icon: User, href: "/settings/profile" },
	{
		id: "appearance",
		label: "Appearance",
		icon: Palette,
		href: "/settings/appearance",
	},
	{
		id: "ssh-keys",
		label: "SSH Keys",
		icon: KeyRound,
		href: "/settings/ssh-keys",
	},
	{
		id: "channels",
		label: "Channels",
		icon: Network,
		href: "/settings/channels",
	},
];

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
	if (!(await logtoClient.isAuthenticated())) {
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
		if (error instanceof HttpError && error.status === 401) {
			await logtoClient.signIn(`${window.location.origin}/callback`);
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
		const cached = getCachedSessionList(spaceId);
		if (cached && cached.length > 0) {
			sessions = cached;
		}
	}

	const shouldShowLoading = sessions.length === 0;
	if (shouldShowLoading) {
		loadingSessions = true;
	}

	const cacheMeta = getCachedSessionListMeta(spaceId);
	const shouldFetch = force || !cacheMeta || cacheMeta.isStale;
	if (!shouldFetch) {
		loadingSessions = false;
		return;
	}

	try {
		sessions = await fetchSessionListWithCache(
			spaceId,
			async () => {
				const result = await sdk.space(spaceId).sessions.list();
				return result.sessions ?? [];
			},
			{ force },
		);
	} catch (error) {
		console.warn("[sidebar] Failed to load sessions", { spaceId, error });
	} finally {
		loadingSessions = false;
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

function markSessionStreaming(sessionId: string, isSessionStreaming: boolean) {
	const next = new Set(streamingSessionIds);
	if (isSessionStreaming) {
		next.add(sessionId);
	} else {
		next.delete(sessionId);
	}
	streamingSessionIds = next;
}

function handleStreamingStatusEvent(e: Event) {
	const custom = e as CustomEvent;
	if (
		custom.detail?.sessionId != null &&
		typeof custom.detail?.isStreaming === "boolean"
	) {
		markSessionStreaming(custom.detail.sessionId, custom.detail.isStreaming);
	}
}

async function handleNavigate(href: string) {
	onClose?.();
	await goto(href);
}

async function handleNavigateToSpace(spaceId: string) {
	showSpaceModal = false;
	onClose?.();
	await goto(buildSpaceDetailRoute(spaceId));
}

async function handleNavigateToSession(sessionId: string) {
	onClose?.();
	const session = sessions.find((s) => s.id === sessionId);
	if (session?.lastMessageId) {
		unreadTracker.markViewed(sessionId, session.lastMessageId);
	}
	if (!currentSpaceId) return;
	await goto(buildSpaceSessionRoute(currentSpaceId, sessionId));
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
		sessions = patchCachedSessionList(currentSpaceId, (current) => [
			result.session,
			...current.filter((session) => session.id !== result.session.id),
		]);
		void loadSessionsForSpace(currentSpaceId, true);
		await handleNavigateToSession(result.session.id);
	} catch (error) {
		createSessionError =
			error instanceof Error ? error.message : "Failed to create session";
	} finally {
		creatingSession = false;
	}
}

function sessionIsStreaming(session: SessionRecord): boolean {
	return isStreaming(session, streamingSessionIds);
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
	clearAllCachedSpaceLists();
	clearAllCachedSessionLists();
	try {
		await logtoClient.signOut(`${window.location.origin}/`);
	} catch (error) {
		console.error("[sidebar] Failed to sign out", error);
	}
}

onMount(() => {
	let offSpaceListCacheUpdated = () => {};
	let offSessionListCacheUpdated = () => {};
	if (mode === "space") {
		offSpaceListCacheUpdated = onSpaceListCacheUpdated(
			({ spaces: nextSpaces }) => {
				if (!authStore.isAuthenticated) return;
				spaces = nextSpaces;
			},
		);
		offSessionListCacheUpdated = onSessionListCacheUpdated(
			({ spaceId, sessions: nextSessions }) => {
				if (spaceId !== currentSpaceId) return;
				sessions = nextSessions;
			},
		);
		void (async () => {
			await loadSpaces();

			window.addEventListener(
				"cohub:streaming-status",
				handleStreamingStatusEvent as EventListener,
			);
			window.addEventListener(
				"cohub:space-created",
				handleSpaceCreated as EventListener,
			);
			window.addEventListener(
				"cohub:checkpoints-updated",
				handleCheckpointsUpdated as EventListener,
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
		document.removeEventListener("click", handleClickOutside);
		if (mode === "space") {
			window.removeEventListener(
				"cohub:streaming-status",
				handleStreamingStatusEvent as EventListener,
			);
			window.removeEventListener(
				"cohub:space-created",
				handleSpaceCreated as EventListener,
			);
			window.removeEventListener(
				"cohub:checkpoints-updated",
				handleCheckpointsUpdated as EventListener,
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
			const authenticated = await logtoClient.isAuthenticated();
			if (requestedSpaceId !== currentSpaceId) return;
			if (!authenticated && !currentSpace) {
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
		untrack(() => {
			void loadSessionsForSpace(id);
			void loadCheckpointsForSpace(id, true);
			void loadCronjobsForSpace(id, true);
			void loadTasksForSpace(id, true);
		});
	} else {
		sessions = [];
		checkpoints = [];
		cronjobs = [];
		tasks = [];
	}
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
  <div class="h-[48px] flex items-center px-3 border-b border-border-subtle shrink-0">
    <a href="/" class="flex items-center gap-2 group" aria-label="Cohub">
      <div class="w-7 h-7 bg-[#FF3E00] rounded-[6px] flex items-center justify-center font-bold text-[11px] text-white group-hover:bg-brand-hover transition-colors">
        C
      </div>
      <span class="font-semibold text-[13px] text-text-primary tracking-tight">Cohub</span>
    </a>
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
        <button
          type="button"
          class="flex items-center gap-2 w-full px-2 py-1.5 rounded-[5px] text-text-tertiary hover:text-text-primary hover:bg-bg-hover transition-colors duration-100 disabled:opacity-50"
          onclick={() => { void handleCreateNewSession(); }}
          disabled={creatingSession}
          title="New chat"
        >
          {#if creatingSession}
            <Loader2 class="w-3.5 h-3.5 animate-spin shrink-0" />
          {:else}
            <Plus class="w-3.5 h-3.5 shrink-0" />
          {/if}
          <span class="text-[12px] font-medium">New Chat</span>
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
                  <a
                    href={buildSpaceSessionRoute(currentSpaceId!, session.id)}
                    class="flex items-center gap-1.5 px-2 py-1.5 mx-[-2px] rounded-[6px] text-[13px] transition-colors duration-100 {isActive ? 'text-text-primary bg-bg-active font-medium' : 'text-text-tertiary hover:text-text-secondary hover:bg-bg-hover'}"
                    onclick={(e) => { e.preventDefault(); handleNavigateToSession(session.id); }}
                    title={sourceTooltip(session.source) || undefined}
                  >
                    <span class="truncate leading-tight flex-1">{getSessionTitle(session, index)}</span>
                    {#if sourceBadge(session.source)}
                      <span class="shrink-0 px-1.5 py-px rounded-[3px] bg-bg-hover-strong text-[10px] font-medium leading-none text-text-tertiary">
                        {sourceBadge(session.source)}
                      </span>
                    {/if}
                    {#if sessionIsStreaming(session)}
                      <div class="w-[6px] h-[6px] rounded-full shrink-0 bg-status-running animate-pulse" title="Streaming..."></div>
                    {:else if unreadTracker.isUnread(session)}
                      <div class="w-[7px] h-[7px] rounded-full shrink-0 bg-brand" title="Unread"></div>
                    {/if}
                  </a>
                {/each}
              </div>
            {/if}
          {:else if activeSession}
            <a
              href={buildSpaceSessionRoute(currentSpaceId!, activeSession.id)}
              class="flex items-center gap-1.5 px-2 py-1.5 mx-[-2px] mt-1 rounded-[6px] text-[13px] transition-colors duration-100 text-text-primary bg-bg-active font-medium"
              onclick={(e) => { e.preventDefault(); handleNavigateToSession(activeSession.id); }}
              title={sourceTooltip(activeSession.source) || undefined}
            >
              <span class="truncate leading-tight flex-1">{getSessionTitle(activeSession, 0)}</span>
            </a>
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
                      class="flex items-center gap-2 px-2 py-1.5 mx-[-2px] rounded-[6px] text-[13px] transition-colors duration-100 {isActive ? 'text-text-primary bg-bg-active font-medium' : 'text-text-tertiary hover:text-text-secondary hover:bg-bg-hover'}"
                      onclick={(e) => { e.preventDefault(); handleNavigateToCheckpoint(checkpoint.id); }}
                    >
                      <History class="w-3.5 h-3.5 shrink-0 text-text-placeholder" />
                      <div class="min-w-0 flex-1">
                        <div class="truncate leading-tight">{getCheckpointTitle(checkpoint)}</div>
                        <div class="mt-0.5 text-[10px] text-text-placeholder font-mono">{checkpoint.commitHash.slice(0, 12)}</div>
                      </div>
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
          onclick={(e) => { e.preventDefault(); handleNavigate(tab.href); }}
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
            onclick={(e) => { e.preventDefault(); showUserMenu = false; handleNavigate('/settings'); }}
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
        {#if authStore.claims?.picture}
          <img src={authStore.claims.picture} alt="avatar" class="w-full h-full object-cover" />
        {:else}
          <svg viewBox="0 0 32 32" class="w-full h-full" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect width="32" height="32" rx="16" fill="#e5e7eb" />
            <circle cx="16" cy="12" r="5" fill="#9ca3af" />
            <ellipse cx="16" cy="26" rx="9" ry="7" fill="#9ca3af" />
          </svg>
        {/if}
      </div>
      <div class="flex-1 min-w-0 text-left">
        <p class="text-[12px] text-text-secondary truncate">{authStore.claims?.name ?? "Guest"}</p>
      </div>
      <ChevronDown class={'w-3 h-3 text-text-tertiary shrink-0 transition-transform duration-150 ' + (showUserMenu ? 'rotate-180' : '')} />
    </button>
  </div>

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
        {#each spaces as space (space.id)}
          {@const isActive = currentSpaceId === space.id}
          {@const status = displayStatus(space)}
          <button
            type="button"
            class="w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors duration-100 {isActive ? 'bg-bg-active' : 'hover:bg-bg-hover'}"
            onclick={() => { void handleNavigateToSpace(space.id); }}
          >
            <!-- Status dot -->
            <span class="w-2 h-2 rounded-full shrink-0 {statusColorClass(status)}"></span>

            <!-- Name & meta -->
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

            <!-- Active indicator -->
            {#if isActive}
              <span class="w-1.5 h-1.5 rounded-full bg-brand shrink-0"></span>
            {/if}
          </button>
        {/each}
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
</aside>
