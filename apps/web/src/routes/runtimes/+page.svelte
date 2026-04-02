<script lang="ts">
import { Cpu, Play, FolderKanban, Power, Moon, Trash2, Loader2, Webhook, MessageSquare, MonitorPlay } from "lucide-svelte";
import { getRuntimes, hibernateRuntime, wakeRuntime, deleteRuntime, type RuntimeListItem } from "$lib/api";
import { onMount } from "svelte";
import { ensureAuth, logtoClient } from "$lib/auth";

let runtimes = $state<RuntimeListItem[]>([]);
let isLoading = $state(true);
let loadError = $state("");
const actionInProgress = $state<Record<string, string>>({});

function displayStatus(runtime: RuntimeListItem) {
  return runtime.liveStatus ?? runtime.status ?? "unknown";
}

function statusBadge(status: string) {
  if (status === "running") return "neo-badge neo-badge-green";
  if (status === "starting" || status === "active") return "neo-badge neo-badge-yellow";
  if (status === "error" || status === "boot_failed") return "neo-badge neo-badge-red";
  if (status === "hibernated") return "neo-badge neo-badge-gray";
  if (status === "hibernating") return "neo-badge neo-badge-blue";
  return "neo-badge neo-badge-white";
}

async function loadRuntimes() {
  if (!(await ensureAuth())) return;
  isLoading = true;
  loadError = "";
  try {
    runtimes = await getRuntimes();
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

async function handleHibernate(runtimeId: string) {
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

async function handleWake(runtimeId: string) {
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

async function handleDelete(runtimeId: string) {
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

onMount(() => {
  loadRuntimes();
});
</script>

<div class="neo-page-shell">
  <div>
    <h1 class="neo-page-title">Runtimes</h1>
    <p class="neo-page-desc mt-3 max-w-2xl">Inspect active runtimes and jump directly into the console for each running agent.</p>
  </div>

  {#if isLoading}
    <div class="neo-loading">Loading runtimes...</div>
  {:else if loadError}
    <div class="neo-error">
      <h2 class="neo-section-title text-white">Load Failed</h2>
      <p class="mt-2 text-sm font-bold break-all">{loadError}</p>
    </div>
  {:else if runtimes.length === 0}
    <div class="neo-empty">
      <div class="neo-icon-box neo-fill-yellow mx-auto mb-4"><Cpu class="w-5 h-5" /></div>
      <h3 class="neo-section-title">No Runtimes Yet</h3>
      <p class="neo-page-desc mt-3 text-sm">Create a runtime from a workspace to see it here.</p>
    </div>
  {:else}
    <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
      {#each runtimes as runtime}
        {@const status = displayStatus(runtime)}
        {@const isBusy = actionInProgress[runtime.id]}
        <div class="neo-list-card p-4 bg-white flex flex-col gap-4">
          <div class="flex items-start justify-between gap-3">
            <div class="neo-icon-box neo-fill-pink">
              <Play class="w-5 h-5" />
            </div>
            <span class={statusBadge(status)}>{status}</span>
          </div>

          <a href="/runtimes/{runtime.id}" class="block">
            <h3 class="text-lg font-black uppercase tracking-tight line-clamp-2 hover:underline">{runtime.title || "Untitled Runtime"}</h3>
          </a>
          <div class="text-xs font-mono break-all text-black/55">{runtime.id}</div>

          <div class="flex flex-wrap gap-2 text-[11px] font-bold text-black/70">
            <span class="neo-badge neo-badge-white normal-case tracking-normal">workspace: {runtime.workspaceId ?? "unbound"}</span>
            <span class="neo-badge neo-badge-white normal-case tracking-normal">sessions: —</span>
          </div>

          {#if runtime.channels && runtime.channels.length > 0}
            <div class="flex flex-wrap gap-1.5">
              {#each runtime.channels as channel}
                {@const ChannelIcon = channel.provider === 'discord' ? MessageSquare : channel.provider === 'feishu' ? Webhook : MonitorPlay}
                <a
                  href="/channels"
                  class="inline-flex items-center gap-1 px-2 py-1 bg-black/5 hover:bg-black/10 rounded text-[10px] font-bold text-black/70 transition-colors"
                  title="{channel.provider}: {channel.name}"
                >
                  <ChannelIcon class="w-3 h-3" />
                  <span class="truncate max-w-[80px]">{channel.name}</span>
                </a>
              {/each}
            </div>
          {:else}
            <div class="text-[11px] text-black/40 italic">No channels bound</div>
          {/if}

          <div class="flex flex-wrap gap-2 mt-2">
            {#if status === "running"}
              <button
                class="neo-btn neo-btn-sm neo-btn-secondary"
                onclick={() => handleHibernate(runtime.id)}
                disabled={!!isBusy}
              >
                {#if isBusy === "hibernate"}
                  <Loader2 class="w-4 h-4 animate-spin" />
                {:else}
                  <Moon class="w-4 h-4" />
                {/if}
                Hibernate
              </button>
            {:else if status === "hibernated"}
              <button
                class="neo-btn neo-btn-sm neo-btn-primary"
                onclick={() => handleWake(runtime.id)}
                disabled={!!isBusy}
              >
                {#if isBusy === "wake"}
                  <Loader2 class="w-4 h-4 animate-spin" />
                {:else}
                  <Power class="w-4 h-4" />
                {/if}
                Wake
              </button>
            {/if}
            {#if status === "hibernated" || status === "error" || status === "boot_failed"}
              <button
                class="neo-btn neo-btn-sm neo-btn-danger"
                onclick={() => handleDelete(runtime.id)}
                disabled={!!isBusy}
              >
                {#if isBusy === "delete"}
                  <Loader2 class="w-4 h-4 animate-spin" />
                {:else}
                  <Trash2 class="w-4 h-4" />
                {/if}
                Delete
              </button>
            {/if}
          </div>

          <div class="mt-auto flex items-center justify-between gap-3 border-t-[3px] border-black pt-3 text-[11px] font-bold text-black/55">
            <a href="/runtimes/{runtime.id}" class="inline-flex items-center gap-1 hover:underline">
              <FolderKanban class="w-3.5 h-3.5" /> Runtime Console
            </a>
            <span>{new Date(runtime.updatedAt).toLocaleString()}</span>
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>
