<script lang="ts">
import { onMount } from "svelte";
import { page } from "$app/state";
import { goto } from "$app/navigation";
import {
  Plus,
  ChevronDown,
  Loader2,
  Settings,
  LogOut,
  Users,
  FolderKanban,
  User,
  Palette,
  KeyRound,
  Network,
} from "lucide-svelte";
import { getSpaces, getSpaceSessions, createSpaceSession, type SessionRecord, type SpaceRecord } from "$lib/api";
import { logtoClient } from "$lib/auth";
import { unreadTracker, isStreaming } from "$lib/stores/session-state.svelte";
import { authStore } from "$lib/stores/auth.svelte";

const {
  isMobile = false,
  onClose,
  mode = "space",
}: {
  isMobile?: boolean;
  onClose?: () => void;
  mode?: "space" | "settings";
} = $props();

const SESSION_POLL_INTERVAL_MS = 15_000;

let isLoading = $state(true);
let loadError = $state("");
let showUserMenu = $state(false);
let showSpaceModal = $state(false);
let spaces = $state<SpaceRecord[]>([]);
let sessions = $state<SessionRecord[]>([]);
let loadingSessions = $state(false);

let streamingSessionIds = $state<Set<string>>(new Set());
let sessionPollingTimer: ReturnType<typeof setTimeout> | null = null;

const currentPath = $derived(page.url.pathname);
const currentSpaceId = $derived.by(() => {
  const match = currentPath.match(/^\/spaces\/([^/]+)/);
  const id = match?.[1] ?? null;
  if (id === "new") return null;
  return id;
});

const currentSpace = $derived(
  currentSpaceId ? spaces.find((s) => s.id === currentSpaceId) ?? null : null,
);

const settingsTabs = [
  { id: "profile", label: "Profile", icon: User, href: "/settings/profile" },
  { id: "appearance", label: "Appearance", icon: Palette, href: "/settings/appearance" },
  { id: "ssh-keys", label: "SSH Keys", icon: KeyRound, href: "/settings/ssh-keys" },
  { id: "channels", label: "Channels", icon: Network, href: "/settings/channels" },
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
    spaces = [];
    return;
  }

  loadError = "";
  const shouldShowInitialLoading = spaces.length === 0;
  if (shouldShowInitialLoading) {
    isLoading = true;
  }

  try {
    spaces = await getSpaces();
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

async function loadSessionsForSpace(spaceId: string, force = false) {
  if (!force && loadingSessions) return;
  const shouldShowLoading = sessions.length === 0;
  if (shouldShowLoading) {
    loadingSessions = true;
  }
  try {
    const result = await getSpaceSessions(spaceId);
    sessions = result.sessions ?? [];
  } catch (error) {
    console.warn("[sidebar] Failed to load sessions", { spaceId, error });
  } finally {
    loadingSessions = false;
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

async function handleNavigateToSpace(spaceId: string) {
  showSpaceModal = false;
  onClose?.();
  await goto(`/spaces/${spaceId}`);
}

async function handleNavigateToSession(sessionId: string) {
  onClose?.();
  const session = sessions.find((s) => s.id === sessionId);
  if (session?.lastMessageId) {
    unreadTracker.markViewed(sessionId, session.lastMessageId);
  }
  await goto(`/spaces/${currentSpaceId}?session=${sessionId}`);
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

function scheduleSessionPoll() {
  if (sessionPollingTimer) clearTimeout(sessionPollingTimer);
  if (!currentSpaceId) return;
  sessionPollingTimer = setTimeout(async () => {
    await loadSessionsForSpace(currentSpaceId, true);
    scheduleSessionPoll();
  }, SESSION_POLL_INTERVAL_MS);
}

onMount(() => {
  if (mode === "space") {
    void (async () => {
      await loadSpaces(true);

      window.addEventListener("cohub:streaming-status", handleStreamingStatusEvent as EventListener);
      window.addEventListener("cohub:space-created", handleSpaceCreated as EventListener);

      scheduleSessionPoll();
    })();
  }

  function handleSpaceCreated() {
    void loadSpaces(true);
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
    if (sessionPollingTimer) clearTimeout(sessionPollingTimer);
    document.removeEventListener("click", handleClickOutside);
    if (mode === "space") {
      window.removeEventListener("cohub:streaming-status", handleStreamingStatusEvent as EventListener);
      window.removeEventListener("cohub:space-created", handleSpaceCreated as EventListener);
    }
  };
});

// Re-poll sessions when currentSpaceId changes
$effect(() => {
  if (mode !== "space") return;
  const id = currentSpaceId;
  if (id) {
    void loadSessionsForSpace(id, true);
  }
  scheduleSessionPoll();
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
    <!-- Space Switcher -->
    <div class="px-2 py-1.5 shrink-0 border-b border-border-subtle">
      <button
        type="button"
        data-space-switcher
        class="w-full flex items-center gap-2 px-2 py-1.5 rounded-[5px] hover:bg-bg-hover transition-colors duration-100 cursor-pointer group"
        onclick={() => { showSpaceModal = !showSpaceModal; void loadSpaces(true); }}
      >
        {#if currentSpace}
          <span class="w-5 h-5 rounded-[4px] flex items-center justify-center shrink-0 {statusColorClass(displayStatus(currentSpace))}">
            <FolderKanban class="w-3 h-3 text-white" />
          </span>
          <span class="flex-1 text-[13px] text-text-primary truncate text-left">{currentSpace.name || currentSpace.title || currentSpace.id.slice(0, 12)}</span>
        {:else}
          <span class="w-5 h-5 rounded-[4px] bg-bg-hover-strong flex items-center justify-center shrink-0">
            <FolderKanban class="w-3 h-3 text-text-tertiary" />
          </span>
          <span class="flex-1 text-[13px] text-text-placeholder truncate text-left">Select a space</span>
        {/if}
        <ChevronDown class="w-3.5 h-3.5 text-text-tertiary shrink-0 transition-transform duration-150 group-hover:text-text-secondary" />
      </button>
    </div>

    <!-- Sessions Section -->
    <div class="flex flex-col min-h-0 flex-1">
      <div class="h-8 flex items-center justify-between px-2 shrink-0">
        <span class="text-[11px] font-semibold uppercase tracking-[0.1em] text-text-placeholder select-none">
          Sessions
        </span>
        {#if currentSpace}
          <button
            type="button"
            class="flex items-center justify-center w-5 h-5 rounded-sm text-text-tertiary hover:text-text-primary hover:bg-bg-hover transition-colors duration-100 cursor-pointer"
            onclick={async () => {
              if (!currentSpaceId) return;
              try {
                const result = await createSpaceSession(currentSpaceId, { source: "web" });
                await handleNavigateToSession(result.session.id);
              } catch (error) {
                console.error("[sidebar] Failed to create session:", error);
                loadError = error instanceof Error ? error.message : "Failed to create session";
              }
            }}
            title="New session"
          >
            <Plus class="w-3.5 h-3.5" />
          </button>
        {/if}
      </div>

      <div class="flex-1 overflow-y-auto px-1.5 pb-2 space-y-[2px]">
        {#if !currentSpace}
          <div class="px-3 py-6 text-[12px] text-text-placeholder text-center">
            Select a space to view sessions
          </div>
        {:else if loadingSessions && sessions.length === 0}
          <div class="px-3 py-4 text-[12px] text-text-tertiary text-center flex items-center justify-center gap-2">
            <Loader2 class="w-3 h-3 animate-spin" />
            Loading...
          </div>
        {:else if sessions.length === 0}
          <div class="px-3 py-4 text-[12px] text-text-placeholder text-center">No sessions</div>
        {:else}
          {#each sessions as session, index (session.id)}
            {@const isActive = page.url.searchParams.get("session") === session.id}
            <a
              href="/spaces/{currentSpaceId}?session={session.id}"
              class="flex items-center gap-1.5 px-2 py-1 rounded-[4px] text-[12.5px] transition-colors duration-100 {isActive ? 'text-text-primary bg-bg-active font-medium' : 'text-text-tertiary hover:text-text-secondary hover:bg-bg-hover'}"
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
        {/if}
      </div>
    </div>
  {:else}
    <!-- Settings Navigation -->
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
  {#if showSpaceModal}
    <div
      role="button"
      tabindex="0"
      class="fixed inset-0 z-[100] flex items-center justify-center"
      onclick={() => { showSpaceModal = false; }}
      onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { showSpaceModal = false; } }}
    >
      <!-- Backdrop -->
      <div class="absolute inset-0 bg-black/60" style="backdrop-filter: blur(4px);"></div>

      <!-- Modal Panel -->
      <div
        role="dialog"
        aria-label="Switch Space"
        tabindex="-1"
        class="relative w-[340px] max-w-[calc(100vw-2rem)] max-h-[70vh] bg-bg-primary border border-border-subtle rounded-lg shadow-2xl overflow-hidden flex flex-col"
        onclick={(e) => e.stopPropagation()}
        onkeydown={(e) => e.stopPropagation()}
      >
        <!-- Header -->
        <div class="flex items-center justify-between px-4 py-3 border-b border-border-subtle shrink-0">
          <h2 class="text-[13px] font-semibold text-text-primary">Switch Space</h2>
          <button
            type="button"
            class="p-1 rounded-sm text-text-tertiary hover:text-text-primary hover:bg-bg-hover transition-colors"
            onclick={() => { showSpaceModal = false; }}
            aria-label="Close"
          >
            <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <!-- Space List -->
        <div class="flex-1 overflow-y-auto py-1">
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
                <!-- Status indicator -->
                <span class="relative shrink-0">
                  <span class="w-7 h-7 rounded-[5px] flex items-center justify-center {isActive ? 'bg-brand' : 'bg-bg-hover-strong'}">
                    <FolderKanban class="w-3.5 h-3.5 {isActive ? 'text-white' : 'text-text-tertiary'}" />
                  </span>
                  <span class="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-bg-primary {statusColorClass(status)}"></span>
                </span>

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

        <!-- Footer: New Space -->
        <div class="border-t border-border-subtle shrink-0">
          <button
            type="button"
            class="w-full flex items-center gap-2 px-4 py-2.5 text-[13px] text-brand hover:bg-bg-hover transition-colors duration-100"
            onclick={() => { showSpaceModal = false; handleNavigate("/spaces/new"); }}
          >
            <Plus class="w-3.5 h-3.5" />
            <span>New Space</span>
          </button>
        </div>
      </div>
    </div>
  {/if}
</aside>
