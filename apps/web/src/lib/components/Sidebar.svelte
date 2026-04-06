<script lang="ts">
import { onMount, tick } from "svelte";
import { page } from "$app/state";
import { goto } from "$app/navigation";
import {
  FolderKanban,
  Network,
  Cpu,
  Plus,
  ChevronRight,
  ChevronDown,
  MessageSquare,
  Loader2,
  Settings,
  LogOut,
} from "lucide-svelte";
import {
  getRuntimes,
  getRuntimeSessions,
  hibernateRuntime,
  wakeRuntime,
  deleteRuntime,
  type RuntimeListItem,
  type SessionRecord,
} from "$lib/api";
import { ensureAuth, logtoClient } from "$lib/auth";
import type { IdTokenClaims } from "@logto/browser";

let userClaims = $state<IdTokenClaims | null>(null);
let runtimes = $state<RuntimeListItem[]>([]);
let sessionsByRuntime = $state<Record<string, SessionRecord[]>>({});
let expandedRuntimes = $state<Set<string>>(new Set());
let isLoading = $state(true);
let loadError = $state("");
const actionInProgress = $state<Record<string, string>>({});

const currentPath = $derived(page.url.pathname);
const currentRuntimeId = $derived.by(() => {
  const match = currentPath.match(/^\/runtimes\/([^/]+)/);
  return match?.[1] ?? null;
});

// Auto-expand the current runtime
$effect(() => {
  if (currentRuntimeId && !expandedRuntimes.has(currentRuntimeId)) {
    expandedRuntimes = new Set(expandedRuntimes).add(currentRuntimeId);
  }
});

function isNavItemActive(href: string) {
  if (href === "/") return currentPath === "/";
  return currentPath.startsWith(href);
}

function isRuntimeActive(runtimeId: string) {
  return currentRuntimeId === runtimeId;
}

function isSessionActive(sessionId: string) {
  const sessionIdParam = page.url.searchParams.get("session");
  return sessionIdParam === sessionId;
}

function displayStatus(runtime: RuntimeListItem) {
  return runtime.liveStatus ?? runtime.status ?? "unknown";
}

function statusColor(status: string) {
  if (status === "running") return "bg-emerald-400";
  if (status === "starting" || status === "active") return "bg-amber-400";
  if (status === "error" || status === "boot_failed") return "bg-rose-400";
  if (status === "hibernated") return "bg-gray-500";
  if (status === "hibernating") return "bg-blue-400";
  return "bg-text-placeholder";
}

function toggleRuntime(runtimeId: string) {
  const next = new Set(expandedRuntimes);
  if (next.has(runtimeId)) {
    next.delete(runtimeId);
  } else {
    next.add(runtimeId);
  }
  expandedRuntimes = next;
}

async function loadRuntimes() {
  if (!(await ensureAuth())) return;
  isLoading = true;
  loadError = "";
  try {
    const data = await getRuntimes();
    runtimes = data;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load runtimes";
    if (message.includes("unauthorized") || message.includes("401")) {
      await logtoClient.signIn(`${window.location.origin}/callback`);
      return;
    }
    loadError = message;
  } finally {
    isLoading = false;
  }
}

async function loadSessions(runtimeId: string) {
  if (sessionsByRuntime[runtimeId]) return;
  try {
    const result = await getRuntimeSessions(runtimeId);
    sessionsByRuntime = {
      ...sessionsByRuntime,
      [runtimeId]: result.sessions ?? [],
    };
  } catch {
    // Silently fail — sessions will load when user navigates
  }
}

async function handleNavigate(href: string) {
  await goto(href);
}

async function handleNavigateToRuntime(runtimeId: string) {
  await goto(`/runtimes/${runtimeId}`);
}

async function handleNavigateToSession(runtimeId: string, sessionId: string) {
  await goto(`/runtimes/${runtimeId}?session=${sessionId}`);
}

function getSessionTitle(session: SessionRecord, index: number) {
  const candidates = [session.title, session.latestMessageText];
  for (const candidate of candidates) {
    const normalized = candidate?.replace(/\s+/g, " ").replace(/^[:\-\s]+/, "").trim();
    if (normalized) return normalized.slice(0, 36);
  }
  return `Session ${index + 1}`;
}

async function handleHibernate(runtimeId: string, e: Event) {
  e.stopPropagation();
  actionInProgress[runtimeId] = "hibernate";
  try {
    await hibernateRuntime(runtimeId);
    await loadRuntimes();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to hibernate";
    alert(message);
  } finally {
    delete actionInProgress[runtimeId];
  }
}

async function handleWake(runtimeId: string, e: Event) {
  e.stopPropagation();
  actionInProgress[runtimeId] = "wake";
  try {
    await wakeRuntime(runtimeId);
    await loadRuntimes();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to wake";
    alert(message);
  } finally {
    delete actionInProgress[runtimeId];
  }
}

async function handleDelete(runtimeId: string, e: Event) {
  e.stopPropagation();
  if (!confirm("Are you sure you want to delete this runtime?")) return;
  actionInProgress[runtimeId] = "delete";
  try {
    await deleteRuntime(runtimeId);
    await loadRuntimes();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to delete";
    alert(message);
  } finally {
    delete actionInProgress[runtimeId];
  }
}

async function handleLogout() {
  await logtoClient.signOut(`${window.location.origin}/`);
}

// Polling for runtime status updates
let pollingTimer: ReturnType<typeof setInterval> | null = null;

function shouldPoll() {
  return runtimes.some((r) => {
    const status = displayStatus(r);
    return status === "starting" || status === "hibernating" || status === "active";
  });
}
onMount(() => {
  void (async () => {
    const authenticated = await ensureAuth();
    if (authenticated) {
      try {
        userClaims = await logtoClient.getIdTokenClaims();
      } catch {
        // ignore
      }
    }
    await loadRuntimes();

    pollingTimer = setInterval(() => {
      if (!shouldPoll()) return;
      void loadRuntimes();
    }, 3000);
  })();

  return () => {
    if (pollingTimer) clearInterval(pollingTimer);
  };
});
</script>

<aside class="w-64 flex flex-col bg-bg-primary border-r border-border-primary shrink-0 h-screen">
  <!-- Logo -->
  <div class="h-12 flex items-center px-4 border-b border-border-primary shrink-0">
    <a href="/" class="flex items-center gap-2.5 group" aria-label="Cohub">
      <div class="w-7 h-7 bg-[#FF5A5F] rounded-lg flex items-center justify-center font-bold text-xs text-white group-hover:bg-[#FF5A5F]/80 transition-colors">
        C
      </div>
      <span class="font-semibold text-sm text-text-primary tracking-tight">Cohub</span>
    </a>
  </div>

  <!-- Top Navigation -->
  <nav class="px-2 py-3 space-y-0.5 shrink-0 border-b border-border-primary">
    <a
      href="/workspaces"
      class="flex items-center gap-2.5 px-2.5 py-2 rounded-md text-sm transition-colors {isNavItemActive('/workspaces') ? 'bg-hover-strong text-text-primary' : 'text-text-tertiary hover:text-text-secondary hover:bg-hover'}"
      onclick={(e) => { e.preventDefault(); handleNavigate('/workspaces'); }}
    >
      <FolderKanban class="w-4 h-4 shrink-0" />
      <span>Workspaces</span>
    </a>
    <a
      href="/channels"
      class="flex items-center gap-2.5 px-2.5 py-2 rounded-md text-sm transition-colors {isNavItemActive('/channels') ? 'bg-hover-strong text-text-primary' : 'text-text-tertiary hover:text-text-secondary hover:bg-hover'}"
      onclick={(e) => { e.preventDefault(); handleNavigate('/channels'); }}
    >
      <Network class="w-4 h-4 shrink-0" />
      <span>Channels</span>
    </a>
    <a
      href="/explore"
      class="flex items-center gap-2.5 px-2.5 py-2 rounded-md text-sm transition-colors {isNavItemActive('/explore') ? 'bg-hover-strong text-text-primary' : 'text-text-tertiary hover:text-text-secondary hover:bg-hover'}"
      onclick={(e) => { e.preventDefault(); handleNavigate('/explore'); }}
    >
      <MessageSquare class="w-4 h-4 shrink-0" />
      <span>Explore</span>
    </a>
  </nav>

  <!-- Runtimes Section -->
  <div class="flex flex-col min-h-0 flex-1">
    <div class="h-8 flex items-center justify-between px-3 shrink-0">
      <div class="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-text-tertiary select-none">
        <Cpu class="w-3.5 h-3.5" />
        Runtimes
      </div>
      <button
        type="button"
        class="flex items-center justify-center w-5 h-5 rounded text-text-tertiary hover:text-text-secondary hover:bg-hover transition-colors"
        onclick={() => handleNavigate('/runtimes')}
        title="View all runtimes"
      >
        <Plus class="w-3.5 h-3.5" />
      </button>
    </div>

    <div class="flex-1 overflow-y-auto px-2 pb-2 space-y-0.5">
      {#if isLoading}
        <div class="px-3 py-4 text-xs text-text-tertiary text-center flex items-center justify-center gap-2">
          <Loader2 class="w-3 h-3 animate-spin" />
          Loading...
        </div>
      {:else if loadError}
        <div class="px-3 py-3 text-xs text-rose-400/70 text-center">{loadError}</div>
      {:else if runtimes.length === 0}
        <div class="px-3 py-4 text-xs text-text-tertiary text-center">No runtimes</div>
      {:else}
        {#each runtimes as runtime (runtime.id)}
          {@const isExpanded = expandedRuntimes.has(runtime.id)}
          {@const isActive = isRuntimeActive(runtime.id)}
          {@const status = displayStatus(runtime)}
          {@const isBusy = actionInProgress[runtime.id]}
          {@const sessions = sessionsByRuntime[runtime.id] ?? []}

          <div>
            <!-- Runtime Row -->
            <div
              role="button"
              tabindex="0"
              class="group flex items-center gap-1.5 px-2 py-1.5 rounded-md text-sm cursor-pointer transition-colors {isActive ? 'bg-hover-strong text-text-primary' : 'text-text-tertiary hover:text-text-secondary hover:bg-hover'}"
              onclick={() => {
                toggleRuntime(runtime.id);
                if (!isExpanded) void loadSessions(runtime.id);
                handleNavigateToRuntime(runtime.id);
              }}
              onkeydown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  toggleRuntime(runtime.id);
                  if (!isExpanded) void loadSessions(runtime.id);
                  handleNavigateToRuntime(runtime.id);
                }
              }}
            >
              <span
                class="flex items-center justify-center w-4 h-4 shrink-0 text-text-tertiary hover:text-text-secondary transition-colors cursor-pointer"
              >
                {#if isExpanded}
                  <ChevronDown class="w-3 h-3" />
                {:else}
                  <ChevronRight class="w-3 h-3" />
                {/if}
              </span>
              <div class="w-1.5 h-1.5 rounded-full shrink-0 {statusColor(status)}"></div>
              <span class="truncate text-xs font-mono flex-1">{runtime.title || runtime.id.slice(0, 12)}</span>
              {#if isBusy}
                <Loader2 class="w-3 h-3 animate-spin text-text-tertiary shrink-0" />
              {/if}
              <!-- Runtime actions (hover) -->
              <div class="hidden group-hover:flex items-center gap-0.5 shrink-0">
                {#if status === "running"}
                  <button
                    type="button"
                    class="p-0.5 rounded text-text-tertiary hover:text-amber-400 hover:bg-hover-strong transition-colors"
                    onclick={(e) => handleHibernate(runtime.id, e)}
                    title="Hibernate"
                  >
                    <ChevronDown class="w-3 h-3 rotate-180" />
                  </button>
                {:else if status === "hibernated"}
                  <button
                    type="button"
                    class="p-0.5 rounded text-text-tertiary hover:text-emerald-400 hover:bg-hover-strong transition-colors"
                    onclick={(e) => handleWake(runtime.id, e)}
                    title="Wake"
                  >
                    <ChevronDown class="w-3 h-3" />
                  </button>
                {/if}
              </div>
            </div>

            <!-- Sessions (when expanded) -->
            {#if isExpanded}
              <div class="ml-4 pl-3 border-l border-border-subtle space-y-0.5 py-0.5">
                {#if sessions.length === 0}
                  <div class="px-2 py-1.5 text-[11px] text-text-placeholder">No sessions</div>
                {:else}
                  {#each sessions as session, index (session.id)}
                    <a
                      href="/runtimes/{runtime.id}?session={session.id}"
                      class="flex items-center gap-2 px-2 py-1.5 rounded-md text-xs transition-colors {isSessionActive(session.id) ? 'text-text-primary bg-hover-strong' : 'text-text-tertiary hover:text-text-secondary hover:bg-hover'}"
                      onclick={(e) => { e.preventDefault(); handleNavigateToSession(runtime.id, session.id); }}
                    >
                      <div class="w-1 h-1 rounded-full shrink-0 {isSessionActive(session.id) ? 'bg-emerald-400' : 'bg-text-placeholder'}"></div>
                      <span class="truncate">{getSessionTitle(session, index)}</span>
                    </a>
                  {/each}
                {/if}
              </div>
            {/if}
          </div>
        {/each}
      {/if}
    </div>
  </div>

  <!-- Bottom: User + Settings -->
  <div class="border-t border-border-primary p-2 space-y-0.5 shrink-0">
    <a
      href="/settings"
      class="flex items-center gap-2.5 px-2.5 py-2 rounded-md text-sm text-text-tertiary hover:text-text-secondary hover:bg-hover transition-colors"
      onclick={(e) => { e.preventDefault(); handleNavigate('/settings'); }}
    >
      <Settings class="w-4 h-4" />
      <span>Settings</span>
    </a>
    <div class="flex items-center gap-2.5 px-2.5 py-2 rounded-md">
      <div class="w-6 h-6 rounded-full bg-hover-strong overflow-hidden shrink-0">
        {#if userClaims?.picture}
          <img src={userClaims.picture} alt="avatar" class="w-full h-full object-cover" />
        {:else}
          <img src="https://api.dicebear.com/7.x/notionists/svg?seed={userClaims?.sub ?? 'anonymous'}" alt="avatar" class="w-full h-full object-cover" />
        {/if}
      </div>
      <div class="flex-1 min-w-0">
        <p class="text-xs text-text-secondary truncate">{userClaims?.name ?? 'Guest'}</p>
      </div>
      <button
        onclick={handleLogout}
        class="p-1.5 rounded text-text-tertiary hover:text-text-secondary hover:bg-hover transition-colors"
        title="Sign out"
      >
        <LogOut class="w-3.5 h-3.5" />
      </button>
    </div>
  </div>
</aside>
