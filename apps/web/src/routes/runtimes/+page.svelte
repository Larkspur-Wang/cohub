<script lang="ts">
import { Cpu, Play, Moon, Power, Trash2, Loader2, MessageSquare, Webhook, MonitorPlay, X } from "lucide-svelte";
import { getRuntimes, hibernateRuntime, wakeRuntime, deleteRuntime, type RuntimeListItem } from "$lib/api";
import { onMount } from "svelte";
import { goto } from "$app/navigation";
import { ensureAuth, logtoClient } from "$lib/auth";

let runtimes = $state<RuntimeListItem[]>([]);
let isLoading = $state(true);
let loadError = $state("");
const actionInProgress = $state<Record<string, string>>({});
let actionError = $state("");

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

function sortedRuntimes(list: RuntimeListItem[]): RuntimeListItem[] {
  return list.toSorted((a, b) => {
    const statusOrder = ["starting", "hibernating", "running", "active", "hibernated", "error", "boot_failed"];
    const pa = statusOrder.indexOf(displayStatus(a));
    const pb = statusOrder.indexOf(displayStatus(b));
    const orderA = pa === -1 ? Number.POSITIVE_INFINITY : pa;
    const orderB = pb === -1 ? Number.POSITIVE_INFINITY : pb;
    if (orderA !== orderB) return orderA - orderB;
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  });
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
  actionError = "";
  try {
    await hibernateRuntime(runtimeId);
    await loadRuntimes();
  } catch (error) {
    actionError = error instanceof Error ? error.message : "Failed to hibernate";
  } finally {
    delete actionInProgress[runtimeId];
  }
}

async function handleWake(runtimeId: string) {
  actionInProgress[runtimeId] = "wake";
  actionError = "";
  try {
    await wakeRuntime(runtimeId);
    await loadRuntimes();
  } catch (error) {
    actionError = error instanceof Error ? error.message : "Failed to wake";
  } finally {
    delete actionInProgress[runtimeId];
  }
}

async function handleDelete(runtimeId: string) {
  if (!confirm("Are you sure you want to delete this runtime?")) return;
  actionInProgress[runtimeId] = "delete";
  actionError = "";
  try {
    await deleteRuntime(runtimeId);
    await loadRuntimes();
  } catch (error) {
    actionError = error instanceof Error ? error.message : "Failed to delete";
  } finally {
    delete actionInProgress[runtimeId];
  }
}

onMount(() => {
  loadRuntimes();
});
</script>

<div class="flex-1 flex flex-col min-h-0 overflow-y-auto">
  <!-- Header -->
  <div class="h-10 flex items-center justify-between px-4 border-b border-border-primary shrink-0 bg-bg-primary">
    <span class="text-xs font-medium text-text-secondary">Runtimes</span>
  </div>

  <div class="flex-1 p-4 overflow-y-auto">
    {#if isLoading}
      <div class="flex items-center justify-center py-12 text-xs text-text-tertiary">
        <div class="w-4 h-4 rounded-full border-2 border-border-primary border-t-emerald-400 animate-spin mr-2"></div>
        Loading runtimes...
      </div>
    {:else if loadError}
      <div class="rounded-md border border-rose-500/20 bg-rose-500/10 p-3 text-xs font-mono text-rose-400 break-all">{loadError}</div>
    {:else if actionError}
      <div class="mx-4 mb-3 rounded-md border border-rose-500/20 bg-rose-500/10 p-3 text-xs font-mono text-rose-400 break-all flex items-center justify-between">
        <span>{actionError}</span>
        <button onclick={() => actionError = ""} class="ml-3 text-text-tertiary hover:text-text-secondary shrink-0"><X class="w-3 h-3" /></button>
      </div>
    {:else if runtimes.length === 0}
      <div class="flex flex-col items-center justify-center py-12 text-center">
        <div class="w-10 h-10 rounded-full bg-hover border border-border-primary flex items-center justify-center mb-3">
          <Cpu class="w-4 h-4 text-text-placeholder" />
        </div>
        <p class="text-sm text-text-tertiary">No runtimes yet</p>
        <p class="text-xs text-text-placeholder mt-1">Create a runtime from a workspace to see it here</p>
      </div>
    {:else}
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {#each sortedRuntimes(runtimes) as runtime (runtime.id)}
          {@const status = displayStatus(runtime)}
          {@const isBusy = actionInProgress[runtime.id]}
          <div class="p-3 rounded-lg border border-border-primary bg-bg-surface hover:border-border-primary/20 transition-colors">
            <div class="flex items-start justify-between gap-2 mb-2">
              <div class="flex items-center gap-2 min-w-0">
                <div class="w-2 h-2 rounded-full shrink-0 {statusColor(status)}"></div>
                <a href="/runtimes/{runtime.id}" class="text-sm font-medium text-text-primary truncate block">
                  {runtime.title || "Untitled Runtime"}
                </a>
              </div>
              <span class="px-1.5 py-0.5 rounded text-[10px] bg-hover text-text-tertiary border border-border-primary shrink-0 font-mono">
                {status}
              </span>
            </div>

            <p class="text-[10px] font-mono text-text-placeholder mb-3 truncate">{runtime.id}</p>

            <div class="flex flex-wrap gap-1 mb-3">
              <span class="px-1.5 py-0.5 rounded text-[10px] bg-hover text-text-tertiary border border-border-subtle font-mono">
                ws: {runtime.workspaceId?.slice(0, 8) ?? "unbound"}
              </span>
            </div>

            {#if runtime.channels && runtime.channels.length > 0}
              <div class="flex flex-wrap gap-1 mb-3">
                {#each runtime.channels as channel}
                  {@const ChannelIcon = channel.provider === 'discord' ? MessageSquare : channel.provider === 'feishu' ? Webhook : MonitorPlay}
                  <a
                    href="/channels"
                    class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-hover text-text-tertiary border border-border-subtle hover:bg-hover-strong hover:text-text-secondary transition-colors"
                    title="{channel.provider}: {channel.name}"
                  >
                    <ChannelIcon class="w-2.5 h-2.5" />
                    {channel.name || channel.provider}
                  </a>
                {/each}
              </div>
            {/if}

            <div class="flex flex-wrap gap-1.5 pt-2 border-t border-border-subtle">
              {#if status === "running"}
                <button
                  class="px-2 py-1 rounded text-[10px] bg-hover hover:bg-hover-strong text-text-tertiary hover:text-text-secondary border border-border-primary transition-colors disabled:opacity-50"
                  onclick={() => handleHibernate(runtime.id)}
                  disabled={!!isBusy}
                >
                  {#if isBusy === "hibernate"}
                    <Loader2 class="w-3 h-3 animate-spin inline" />
                  {:else}
                    <Moon class="w-3 h-3 inline" />
                  {/if}
                  Hibernate
                </button>
              {:else if status === "hibernated"}
                <button
                  class="px-2 py-1 rounded text-[10px] bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400/70 border border-emerald-500/20 transition-colors disabled:opacity-50"
                  onclick={() => handleWake(runtime.id)}
                  disabled={!!isBusy}
                >
                  {#if isBusy === "wake"}
                    <Loader2 class="w-3 h-3 animate-spin inline" />
                  {:else}
                    <Power class="w-3 h-3 inline" />
                  {/if}
                  Wake
                </button>
              {/if}
              {#if status === "hibernated" || status === "error" || status === "boot_failed"}
                <button
                  class="px-2 py-1 rounded text-[10px] bg-rose-500/10 hover:bg-rose-500/20 text-rose-400/70 border border-rose-500/20 transition-colors disabled:opacity-50"
                  onclick={() => handleDelete(runtime.id)}
                  disabled={!!isBusy}
                >
                  {#if isBusy === "delete"}
                    <Loader2 class="w-3 h-3 animate-spin inline" />
                  {:else}
                    <Trash2 class="w-3 h-3 inline" />
                  {/if}
                  Delete
                </button>
              {/if}
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </div>
</div>
