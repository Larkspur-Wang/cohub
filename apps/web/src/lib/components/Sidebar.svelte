<script lang="ts">
import { onMount, untrack } from "svelte";
import { page } from "$app/state";
import { goto } from "$app/navigation";
import {
  Plus,
  ChevronRight,
  ChevronDown,
  Loader2,
  Settings,
  LogOut,
  Users,
  Clock,
  Network,
  FolderKanban,
  Sparkles,
} from "lucide-svelte";
import { getSpaces, getSpaceSessions, type SessionRecord, type SpaceRecord } from "$lib/api";
import { logtoClient } from "$lib/auth";
import { unreadTracker, isStreaming } from "$lib/stores/session-state.svelte";
import { authStore } from "$lib/stores/auth.svelte";

const { isMobile = false, onClose }: { isMobile?: boolean; onClose?: () => void } = $props();

const SPACE_POLL_INTERVAL_MS = 15_000;
const SESSION_POLL_INTERVAL_MS = 15_000;

let expandedSpaces = $state<Set<string>>(new Set());
let isLoading = $state(true);
let loadError = $state("");
let showUserMenu = $state(false);
let spaces = $state<SpaceRecord[]>([]);
let sessionsBySpace = $state<Record<string, SessionRecord[]>>({});
let loadingSessionsBySpace = $state<Record<string, boolean>>({});

let streamingSessionIds = $state<Set<string>>(new Set());
let spacePollingTimer: ReturnType<typeof setTimeout> | null = null;
let sessionPollingTimer: ReturnType<typeof setTimeout> | null = null;

const currentPath = $derived(page.url.pathname);
const currentSpaceId = $derived.by(() => {
  const match = currentPath.match(/^\/spaces\/([^/]+)/);
  const id = match?.[1] ?? null;
  if (id === "new") return null;
  return id;
});

$effect(() => {
  const id = currentSpaceId;
  untrack(() => {
    if (id && !expandedSpaces.has(id)) {
      expandedSpaces = new Set(expandedSpaces).add(id);
      void loadSessions(id, true);
    }
  });
});

$effect(() => {
  void expandedSpaces.size;
  rescheduleSessionPoll();
});

function isNavItemActive(href: string) {
  if (href === "/") return currentPath === "/";
  return currentPath.startsWith(href);
}

function isSpaceActive(spaceId: string) {
  return currentSpaceId === spaceId;
}

function isSessionActive(sessionId: string) {
  const sessionIdParam = page.url.searchParams.get("session");
  return sessionIdParam === sessionId;
}

function getSessions(spaceId: string) {
  return sessionsBySpace[spaceId] ?? [];
}

function sourceBadge(source: string | null): string {
  if (!source || source === "web") return "";
  const idx = source.indexOf(":");
  return idx > 0 ? source.slice(0, idx) : source;
}

function sourceTooltip(source: string | null): string {
  return source ?? "";
}

function toggleSpace(spaceId: string) {
  const next = new Set(expandedSpaces);
  if (next.has(spaceId)) {
    next.delete(spaceId);
  } else {
    next.add(spaceId);
  }
  expandedSpaces = next;
}

async function loadSpaces(force = false) {
  if (!(await logtoClient.isAuthenticated())) {
    isLoading = false;
    spaces = [];
    return;
  }

  loadError = "";
  const shouldShowInitialLoading = spaces.length === 0;
  if (shouldShowInitialLoading) {
    isLoading = true;
  }

  try {
    const nextSpaces = await getSpaces();
    const validIds = new Set(nextSpaces.map((space) => space.id));
    const nextSessionsBySpace: Record<string, SessionRecord[]> = {};
    const nextLoadingBySpace: Record<string, boolean> = {};
    for (const [spaceId, sessions] of Object.entries(sessionsBySpace)) {
      if (validIds.has(spaceId)) nextSessionsBySpace[spaceId] = sessions;
    }
    for (const [spaceId, loading] of Object.entries(loadingSessionsBySpace)) {
      if (validIds.has(spaceId)) nextLoadingBySpace[spaceId] = loading;
    }
    spaces = nextSpaces;
    sessionsBySpace = nextSessionsBySpace;
    loadingSessionsBySpace = nextLoadingBySpace;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load spaces";
    if (message.includes("unauthorized") || message.includes("401")) {
      await logtoClient.signIn(`${window.location.origin}/callback`);
      return;
    }
    loadError = message;
  } finally {
    isLoading = false;
  }
}

async function loadSessions(spaceId: string, force = false) {
  if (!force && loadingSessionsBySpace[spaceId]) return;
  const shouldShowLoading = (sessionsBySpace[spaceId]?.length ?? 0) === 0;
  if (shouldShowLoading) {
    loadingSessionsBySpace = { ...loadingSessionsBySpace, [spaceId]: true };
  }
  try {
    const result = await getSpaceSessions(spaceId);
    sessionsBySpace = {
      ...sessionsBySpace,
      [spaceId]: result.sessions ?? [],
    };
  } catch (error) {
    console.warn("[sidebar] Failed to load sessions", { spaceId, error });
  } finally {
    if (loadingSessionsBySpace[spaceId]) {
      loadingSessionsBySpace = { ...loadingSessionsBySpace, [spaceId]: false };
    }
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
  if (custom.detail?.sessionId != null && typeof custom.detail?.isStreaming === "boolean") {
    markSessionStreaming(custom.detail.sessionId, custom.detail.isStreaming);
  }
}

async function handleNavigate(href: string) {
  onClose?.();
  await goto(href);
}

async function handleToggleSpace(spaceId: string, isExpanded: boolean) {
  if (isExpanded) {
    toggleSpace(spaceId);
    return;
  }

  toggleSpace(spaceId);
  void loadSessions(spaceId, true);

  if (!isMobile) {
    await handleNavigateToSpace(spaceId);
  }
}

async function handleNavigateToSpace(spaceId: string) {
  onClose?.();
  await goto(`/spaces/${spaceId}`);
}

async function handleNavigateToSession(spaceId: string, sessionId: string) {
  onClose?.();
  const session = getSessions(spaceId).find((s) => s.id === sessionId);
  if (session?.lastMessageId) {
    unreadTracker.markViewed(sessionId, session.lastMessageId);
  }
  await goto(`/spaces/${spaceId}?session=${sessionId}`);
}

function sessionIsStreaming(session: SessionRecord): boolean {
  return isStreaming(session, streamingSessionIds);
}

function getSessionTitle(session: SessionRecord, _index: number) {
  const candidates = [session.title, session.latestMessageText];
  for (const candidate of candidates) {
    const normalized = candidate?.replace(/\s+/g, " ").replace(/^[:\-\s]+/, "").trim();
    if (normalized) return normalized.slice(0, 36);
  }
  return "New session";
}

async function handleLogout() {
  onClose?.();
  await logtoClient.signOut(`${window.location.origin}/`);
}

function scheduleSpacePoll() {
  if (spacePollingTimer) clearTimeout(spacePollingTimer);
  spacePollingTimer = setTimeout(async () => {
    await loadSpaces();
    scheduleSpacePoll();
  }, SPACE_POLL_INTERVAL_MS);
}

function scheduleSessionPoll() {
  if (sessionPollingTimer) clearTimeout(sessionPollingTimer);
  const targets = [...expandedSpaces].filter((id) => spaces.some((space) => space.id === id));
  if (targets.length === 0) return;
  sessionPollingTimer = setTimeout(async () => {
    for (const spaceId of targets) {
      await loadSessions(spaceId, true);
    }
    scheduleSessionPoll();
  }, SESSION_POLL_INTERVAL_MS);
}

function rescheduleSessionPoll() {
  scheduleSessionPoll();
}

onMount(() => {
  void (async () => {
    const authenticated = await logtoClient.isAuthenticated();
    if (authenticated) {
      await authStore.ensureLoaded();
    }

    await loadSpaces(true);

    if (currentSpaceId) {
      expandedSpaces = new Set(expandedSpaces).add(currentSpaceId);
      void loadSessions(currentSpaceId, true);
    }

    window.addEventListener("cohub:streaming-status", handleStreamingStatusEvent as EventListener);
    window.addEventListener("cohub:space-created", handleSpaceCreated as EventListener);

    scheduleSpacePoll();
    rescheduleSessionPoll();

    if (!currentSpaceId && spaces.length > 0) {
      const firstSpace = spaces[0];
      expandedSpaces = new Set(expandedSpaces).add(firstSpace.id);
      void loadSessions(firstSpace.id, true);
    }
  })();

  function handleSpaceCreated() {
    void loadSpaces(true);
  }

  function handleClickOutside(e: MouseEvent) {
    const target = e.target as HTMLElement;
    if (!target.closest('[data-user-menu]')) {
      showUserMenu = false;
    }
  }
  document.addEventListener("click", handleClickOutside);

  return () => {
    if (spacePollingTimer) clearTimeout(spacePollingTimer);
    if (sessionPollingTimer) clearTimeout(sessionPollingTimer);
    document.removeEventListener("click", handleClickOutside);
    window.removeEventListener("cohub:streaming-status", handleStreamingStatusEvent as EventListener);
    window.removeEventListener("cohub:space-created", handleSpaceCreated as EventListener);
  };
});
</script>

<aside class="{isMobile ? 'h-full' : 'shrink-0 h-screen'} flex flex-col bg-bg-primary">
  <div class="h-[48px] flex items-center px-3 border-b border-border-subtle shrink-0">
    <a href="/" class="flex items-center gap-2 group" aria-label="Cohub">
      <div class="w-7 h-7 bg-[#FF3E00] rounded-[6px] flex items-center justify-center font-bold text-[11px] text-white group-hover:bg-brand-hover transition-colors">
        C
      </div>
      <span class="font-semibold text-[13px] text-text-primary tracking-tight">Cohub</span>
    </a>
  </div>

  <nav class="px-1.5 py-2 space-y-[2px] shrink-0 border-b border-border-subtle">
    <a
      href="/channels"
      class="flex items-center gap-2 px-2 py-[6px] rounded-[5px] text-[13px] transition-colors duration-100 {isNavItemActive('/channels') ? 'bg-bg-active text-text-primary font-medium' : 'text-text-tertiary hover:text-text-secondary hover:bg-bg-hover'}"
      onclick={(e) => { e.preventDefault(); handleNavigate('/channels'); }}
    >
      <Network class="w-[15px] h-[15px] shrink-0" />
      <span>Channels</span>
    </a>
    <a
      href="/jobs"
      class="flex items-center gap-2 px-2 py-[6px] rounded-[5px] text-[13px] transition-colors duration-100 {isNavItemActive('/jobs') ? 'bg-bg-active text-text-primary font-medium' : 'text-text-tertiary hover:text-text-secondary hover:bg-bg-hover'}"
      onclick={(e) => { e.preventDefault(); handleNavigate('/jobs'); }}
    >
      <Clock class="w-[15px] h-[15px] shrink-0" />
      <span>Jobs</span>
    </a>
  </nav>

  <div class="flex flex-col min-h-0 flex-1">
    <div class="flex items-center justify-between gap-2 px-2 py-2.5 shrink-0 border-b border-border-subtle/80 bg-bg-primary/70 backdrop-blur-sm">
      <div class="min-w-0">
        <div class="text-[10px] font-semibold uppercase tracking-[0.16em] text-text-placeholder select-none">Spaces</div>
        <div class="text-[11px] text-text-tertiary mt-0.5">Cloud workspaces and sessions</div>
      </div>
      <button
        type="button"
        class="inline-flex items-center justify-center w-7 h-7 rounded-[6px] border border-border-subtle bg-bg-elevated text-text-tertiary hover:text-text-primary hover:border-brand/25 hover:bg-bg-hover transition-colors duration-100 cursor-pointer"
        onclick={() => handleNavigate('/spaces/new')}
        title="Create space"
      >
        <Plus class="w-3.5 h-3.5" />
      </button>
    </div>

    <div class="flex-1 overflow-y-auto px-1.5 py-2 space-y-[4px]">
      {#if isLoading}
        <div class="mx-1 rounded-[8px] border border-border-subtle bg-bg-elevated/55 px-3 py-3 text-[12px] text-text-tertiary flex items-center justify-center gap-2">
          <Loader2 class="w-3 h-3 animate-spin" />
          <span>Loading spaces…</span>
        </div>
      {:else if loadError}
        <div class="mx-1 rounded-[8px] border border-error-soft/30 bg-error-bg px-3 py-3 text-[12px] text-error-soft">
          {loadError}
        </div>
      {:else if spaces.length === 0}
        <div class="mx-1 rounded-[10px] border border-dashed border-border-subtle bg-bg-elevated/35 px-3 py-4 text-center">
          <div class="mx-auto mb-2 flex h-8 w-8 items-center justify-center rounded-[8px] border border-border-subtle bg-bg-elevated text-brand">
            <FolderKanban class="w-4 h-4" />
          </div>
          <div class="text-[12px] font-medium text-text-secondary">No spaces yet</div>
          <div class="mt-1 text-[11px] leading-5 text-text-placeholder">Create a space to provision a sandbox and start new sessions when you are ready.</div>
        </div>
      {:else}
        {#each spaces as space (space.id)}
          {@const isExpanded = expandedSpaces.has(space.id)}
          {@const isActive = isSpaceActive(space.id)}
          {@const sessions = getSessions(space.id)}
          {@const loadingSessions = loadingSessionsBySpace[space.id] ?? false}

          <div class="space-y-1.5">
            <div
              role="button"
              tabindex="0"
              class="group relative flex items-center gap-2 rounded-[8px] border px-2 py-2 transition-all duration-100 cursor-pointer {isActive ? 'border-brand/30 bg-brand/6 text-text-primary shadow-[inset_0_1px_0_rgba(255,62,0,0.08)]' : 'border-transparent text-text-secondary hover:border-border-subtle hover:bg-bg-hover/80 hover:text-text-primary'}"
              onclick={() => { void handleToggleSpace(space.id, isExpanded); }}
              onkeydown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  void handleToggleSpace(space.id, isExpanded);
                }
              }}
            >
              <span class="absolute left-0 top-[7px] bottom-[7px] w-[3px] rounded-r-full {isActive ? 'bg-brand' : 'bg-transparent group-hover:bg-border-subtle'}"></span>
              <span class="flex items-center justify-center w-4 h-4 shrink-0 text-text-tertiary group-hover:text-text-secondary transition-colors">
                {#if isExpanded}
                  <ChevronDown class="w-3 h-3" />
                {:else}
                  <ChevronRight class="w-3 h-3" />
                {/if}
              </span>
              <div class="min-w-0 flex-1">
                <div class="truncate text-[13px] font-medium leading-tight">{space.name || space.title || space.id.slice(0, 12)}</div>
                <div class="mt-0.5 flex items-center gap-1.5 text-[10px] uppercase tracking-[0.14em] text-text-placeholder">
                  <span>{space.sandboxStatus ?? 'idle'}</span>
                  {#if sessions.length > 0}
                    <span class="text-text-placeholder/60">•</span>
                    <span>{sessions.length} session{sessions.length > 1 ? 's' : ''}</span>
                  {/if}
                </div>
              </div>
              {#if space.userUuid !== authStore.userUuid}
                <Users class="w-3.5 h-3.5 shrink-0 text-text-tertiary" />
              {/if}
            </div>

            {#if isExpanded}
              <div class="ml-[18px] rounded-[8px] border border-border-subtle/70 bg-bg-elevated/35 px-2 py-2">
                {#if loadingSessions && sessions.length === 0}
                  <div class="px-1 py-1.5 text-[11px] text-text-placeholder italic flex items-center gap-1.5">
                    <Loader2 class="w-3 h-3 animate-spin" />
                    Loading sessions…
                  </div>
                {:else if sessions.length === 0}
                  <div class="rounded-[7px] border border-dashed border-border-subtle/80 bg-bg-primary/45 px-2.5 py-2.5">
                    <div class="flex items-start gap-2">
                      <div class="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] bg-brand/8 text-brand">
                        <Sparkles class="w-3.5 h-3.5" />
                      </div>
                      <div class="min-w-0">
                        <div class="text-[11px] font-medium text-text-secondary">No sessions yet</div>
                        <div class="mt-1 text-[11px] leading-5 text-text-placeholder">Open the space to create the first session when the sandbox is ready.</div>
                      </div>
                    </div>
                  </div>
                {:else}
                  <div class="space-y-1">
                    {#each sessions as session, index (session.id)}
                      <a
                        href="/spaces/{space.id}?session={session.id}"
                        class="flex items-center gap-1.5 rounded-[6px] px-2 py-1.5 text-[12px] transition-colors duration-100 {isSessionActive(session.id) ? 'bg-bg-active text-text-primary' : 'text-text-tertiary hover:bg-bg-hover hover:text-text-secondary'}"
                        onclick={(e) => { e.preventDefault(); handleNavigateToSession(space.id, session.id); }}
                        title={sourceTooltip(session.source) || undefined}
                      >
                        <span class="truncate leading-tight flex-1">{getSessionTitle(session, index)}</span>
                        {#if sourceBadge(session.source)}
                          <span class="shrink-0 rounded-[4px] bg-bg-hover-strong px-1.5 py-px text-[10px] font-medium uppercase tracking-[0.08em] leading-none text-text-tertiary">
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
              </div>
            {/if}
          </div>
        {/each}
      {/if}
    </div>
  </div>

  <div class="border-t border-border-subtle p-1.5 shrink-0 relative">
    {#if showUserMenu}
      <div
        data-user-menu
        class="absolute bottom-full left-1.5 right-1.5 mb-1 bg-bg-primary border border-border-subtle rounded-md shadow-lg overflow-hidden z-50"
      >
        <a
          href="/settings"
          class="flex items-center gap-2 px-2.5 py-[7px] text-[12px] text-text-tertiary hover:text-text-secondary hover:bg-bg-hover transition-colors duration-100"
          onclick={(e) => { e.preventDefault(); showUserMenu = false; handleNavigate('/settings'); }}
        >
          <Settings class="w-3.5 h-3.5" />
          <span>Settings</span>
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
        {#if authStore.claims?.picture}
          <img src={authStore.claims.picture} alt="avatar" class="w-full h-full object-cover" />
        {:else}
          <svg viewBox="0 0 32 32" class="w-full h-full" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect width="32" height="32" fill="#2A2A2A" />
            <circle cx="16" cy="12" r="5" fill="#666" />
            <path d="M8 26c0-4.4 3.6-8 8-8s8 3.6 8 8" fill="#666" />
          </svg>
        {/if}
      </div>
      <div class="min-w-0 flex-1 text-left">
        <p class="text-[12px] text-text-secondary truncate">{authStore.claims?.name ?? 'Guest'}</p>
      </div>
    </button>
  </div>
</aside>
