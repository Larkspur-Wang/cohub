<script lang="ts">
import { Cpu, Plus, Play, Moon, Power, Trash2, Loader2, MessageSquare, Webhook, MonitorPlay, X } from "lucide-svelte";
import { getRuntimes, hibernateRuntime, wakeRuntime, deleteRuntime, type RuntimeListItem } from "$lib/api";
import { onMount } from "svelte";
import { goto } from "$app/navigation";
import { ensureAuth, logtoClient } from "$lib/auth";

let runtimes = $state<RuntimeListItem[]>([]);
let isLoading = $state(true);
let loadError = $state("");
let actionError = $state("");
const actionInProgress = $state<Record<string, string>>({});

function displayStatus(runtime: RuntimeListItem) {
  return runtime.liveStatus ?? runtime.status ?? "unknown";
}

function statusLabel(status: string) {
  if (status === "running") return "Running";
  if (status === "starting" || status === "active") return "Starting";
  if (status === "error" || status === "boot_failed") return "Error";
  if (status === "hibernated") return "Hibernated";
  if (status === "hibernating") return "Hibernating";
  return status;
}

function statusClass(status: string) {
  if (status === "running") return "text-status-running";
  if (status === "starting" || status === "active") return "text-status-starting";
  if (status === "error" || status === "boot_failed") return "text-status-error";
  if (status === "hibernated") return "text-status-hibernated";
  if (status === "hibernating") return "text-status-hibernating";
  return "text-text-placeholder";
}

function dotClass(status: string) {
  if (status === "running") return "bg-status-running";
  if (status === "starting" || status === "active") return "bg-status-starting";
  if (status === "error" || status === "boot_failed") return "bg-status-error";
  if (status === "hibernated") return "bg-status-hibernated";
  if (status === "hibernating") return "bg-status-hibernating";
  return "bg-text-placeholder";
}

// Group runtimes by status category
const activeRuntimes = $derived(runtimes.filter((r) => {
  const s = displayStatus(r);
  return s === "running" || s === "starting" || s === "active" || s === "hibernating";
}).toSorted((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()));

const inactiveRuntimes = $derived(runtimes.filter((r) => {
  const s = displayStatus(r);
  return s === "hibernated" || s === "error" || s === "boot_failed";
}).toSorted((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()));

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
  <div class="h-[40px] flex items-center justify-between px-4 border-b border-border-subtle shrink-0 bg-bg-primary">
    <span class="text-[11px] font-medium text-text-secondary">Runtimes</span>
    <a
      href="/runtimes/new"
      class="flex items-center gap-1.5 px-2.5 py-1 rounded-[5px] text-[12px] bg-[#FF3E00]/10 border border-[#FF3E00]/20 text-brand font-medium hover:bg-[#FF3E00]/15 transition-colors"
    >
      <Plus class="w-3.5 h-3.5" />
      New Runtime
    </a>
  </div>

  <div class="flex-1 p-4 overflow-y-auto">
    {#if isLoading}
      <div class="flex items-center justify-center py-12 text-[12px] text-text-tertiary">
        <div class="w-4 h-4 rounded-full border-2 border-border-subtle border-t-brand animate-spin mr-2"></div>
        Loading runtimes...
      </div>
    {:else if loadError}
      <div class="rounded-md border border-error-soft/30 bg-error-bg p-3 text-[12px] font-mono text-error-soft break-all">{loadError}</div>
    {:else if runtimes.length === 0}
      <div class="flex flex-col items-center justify-center py-16 text-center">
        <div class="w-11 h-11 rounded-md bg-bg-surface border border-border-subtle flex items-center justify-center mb-3">
          <Cpu class="w-5 h-5 text-text-placeholder" />
        </div>
        <p class="text-[14px] text-text-tertiary">No runtimes yet</p>
        <p class="text-[12px] text-text-placeholder mt-1">Create a runtime from a workspace to see it here</p>
        <a href="/runtimes/new" class="mt-4 px-3 py-1.5 rounded-[5px] bg-bg-surface hover:bg-bg-surface-hover border border-border-subtle text-[13px] text-text-secondary hover:text-text-primary transition-colors">
          Create your first runtime
        </a>
      </div>
    {:else}
      {#if actionError}
        <div class="mb-3 rounded-md border border-error-soft/30 bg-error-bg p-3 text-[12px] font-mono text-error-soft flex items-center justify-between">
          <span>{actionError}</span>
          <button onclick={() => actionError = ""} class="ml-3 text-text-tertiary hover:text-text-secondary shrink-0"><X class="w-3 h-3" /></button>
        </div>
      {/if}

      <!-- Active Runtimes -->
      {#if activeRuntimes.length > 0}
        <div class="mb-6">
          <h2 class="text-[10px] font-semibold uppercase tracking-[0.1em] text-text-placeholder mb-2">Active</h2>
          <div class="rounded-md border border-border-subtle overflow-hidden">
            <div class="hidden lg:grid lg:grid-cols-[auto_1fr_auto_auto] lg:gap-3 lg:px-3 lg:py-2 bg-bg-header-alt text-[10px] font-medium uppercase tracking-[0.08em] text-text-placeholder border-b border-border-subtle">
              <span></span>
              <span>Name</span>
              <span>Status</span>
              <span class="text-right">Actions</span>
            </div>
            <div class="divide-y divide-border-subtle">
            {#each activeRuntimes as runtime}
              {@const status = displayStatus(runtime)}
              {@const isBusy = actionInProgress[runtime.id]}
              <div class="hover:bg-bg-hover transition-colors duration-100">
                <!-- Desktop: table row -->
                <div class="hidden lg:grid lg:grid-cols-[auto_1fr_auto_auto] lg:gap-3 lg:px-3 lg:py-2.5">
                  <div class="pt-0.5">
                    <div class="w-[7px] h-[7px] rounded-full {dotClass(status)}"></div>
                  </div>
                  <div class="min-w-0">
                    <a href="/runtimes/{runtime.id}" class="text-[13px] font-medium text-text-primary hover:text-brand transition-colors truncate block">
                      {runtime.title || "Untitled Runtime"}
                    </a>
                    <div class="text-[11px] font-mono text-text-placeholder truncate mt-0.5">{runtime.id}</div>
                  </div>
                  <div class="flex items-center gap-1.5 pt-0.5 shrink-0">
                    <span class="px-1.5 py-0.5 rounded-sm text-[10px] font-medium {statusClass(status)}">
                      {statusLabel(status)}
                    </span>
                  </div>
                  <div class="flex items-center gap-1 shrink-0">
                    {#if status === "running"}
                      <button
                        class="p-1 rounded-sm text-text-tertiary hover:text-warning-soft hover:bg-bg-hover-strong transition-colors"
                        onclick={() => handleHibernate(runtime.id)}
                        disabled={!!isBusy}
                        title="Hibernate"
                      >
                        {#if isBusy === "hibernate"}
                          <Loader2 class="w-3.5 h-3.5 animate-spin" />
                        {:else}
                          <Moon class="w-3.5 h-3.5" />
                        {/if}
                      </button>
                    {:else if status === "hibernated"}
                      <button
                        class="p-1 rounded-sm text-text-tertiary hover:text-success-soft hover:bg-bg-hover-strong transition-colors"
                        onclick={() => handleWake(runtime.id)}
                        disabled={!!isBusy}
                        title="Wake"
                      >
                        {#if isBusy === "wake"}
                          <Loader2 class="w-3.5 h-3.5 animate-spin" />
                        {:else}
                          <Power class="w-3.5 h-3.5" />
                        {/if}
                      </button>
                    {/if}
                    {#if status === "hibernated" || status === "error" || status === "boot_failed"}
                      <button
                        class="p-1 rounded-sm text-text-tertiary hover:text-error-soft hover:bg-bg-hover-strong transition-colors"
                        onclick={() => handleDelete(runtime.id)}
                        disabled={!!isBusy}
                        title="Delete"
                      >
                        {#if isBusy === "delete"}
                          <Loader2 class="w-3.5 h-3.5 animate-spin" />
                        {:else}
                          <Trash2 class="w-3.5 h-3.5" />
                        {/if}
                      </button>
                    {/if}
                  </div>
                </div>

                <!-- Mobile: card layout -->
                <div class="lg:hidden px-3 py-3">
                  <div class="flex items-center gap-2 mb-2">
                    <div class="w-[7px] h-[7px] rounded-full shrink-0 {dotClass(status)}"></div>
                    <a href="/runtimes/{runtime.id}" class="flex-1 text-[13px] font-medium text-text-primary hover:text-brand transition-colors truncate">
                      {runtime.title || "Untitled Runtime"}
                    </a>
                    <span class="px-1.5 py-0.5 rounded-sm text-[10px] font-medium shrink-0 {statusClass(status)}">
                      {statusLabel(status)}
                    </span>
                  </div>
                  <div class="text-[11px] font-mono text-text-placeholder truncate mb-2">{runtime.id}</div>
                  <div class="flex items-center gap-2">
                    {#if status === "running"}
                      <button
                        class="flex items-center gap-1.5 px-2.5 py-1.5 rounded-[5px] bg-bg-code border border-border-subtle text-[12px] text-text-tertiary hover:text-warning-soft hover:bg-bg-hover-strong transition-colors"
                        onclick={() => handleHibernate(runtime.id)}
                        disabled={!!isBusy}
                      >
                        {#if isBusy === "hibernate"}
                          <Loader2 class="w-3.5 h-3.5 animate-spin" />
                        {:else}
                          <Moon class="w-3.5 h-3.5" />
                        {/if}
                        <span>Hibernate</span>
                      </button>
                    {:else if status === "hibernated"}
                      <button
                        class="flex items-center gap-1.5 px-2.5 py-1.5 rounded-[5px] bg-bg-code border border-border-subtle text-[12px] text-text-tertiary hover:text-success-soft hover:bg-bg-hover-strong transition-colors"
                        onclick={() => handleWake(runtime.id)}
                        disabled={!!isBusy}
                      >
                        {#if isBusy === "wake"}
                          <Loader2 class="w-3.5 h-3.5 animate-spin" />
                        {:else}
                          <Power class="w-3.5 h-3.5" />
                        {/if}
                        <span>Wake</span>
                      </button>
                    {/if}
                    {#if status === "hibernated" || status === "error" || status === "boot_failed"}
                      <button
                        class="flex items-center gap-1.5 px-2.5 py-1.5 rounded-[5px] bg-bg-code border border-border-subtle text-[12px] text-text-tertiary hover:text-error-soft hover:bg-bg-hover-strong transition-colors"
                        onclick={() => handleDelete(runtime.id)}
                        disabled={!!isBusy}
                      >
                        {#if isBusy === "delete"}
                          <Loader2 class="w-3.5 h-3.5 animate-spin" />
                        {:else}
                          <Trash2 class="w-3.5 h-3.5" />
                        {/if}
                        <span>Delete</span>
                      </button>
                    {/if}
                  </div>
                </div>
              </div>
            {/each}
            </div>
          </div>
        </div>
      {/if}

      <!-- Inactive Runtimes -->
      {#if inactiveRuntimes.length > 0}
        <div>
          <h2 class="text-[10px] font-semibold uppercase tracking-[0.1em] text-text-placeholder mb-2">Inactive</h2>
          <div class="rounded-md border border-border-subtle overflow-hidden">
            <div class="hidden lg:grid lg:grid-cols-[auto_1fr_auto_auto] lg:gap-3 lg:px-3 lg:py-2 bg-bg-header-alt text-[10px] font-medium uppercase tracking-[0.08em] text-text-placeholder border-b border-border-subtle">
              <span></span>
              <span>Name</span>
              <span>Status</span>
              <span class="text-right">Actions</span>
            </div>
            <div class="divide-y divide-border-subtle">
            {#each inactiveRuntimes as runtime}
              {@const status = displayStatus(runtime)}
              {@const isBusy = actionInProgress[runtime.id]}
              <div class="hover:bg-bg-hover transition-colors duration-100">
                <!-- Desktop: table row -->
                <div class="hidden lg:grid lg:grid-cols-[auto_1fr_auto_auto] lg:gap-3 lg:px-3 lg:py-2.5">
                  <div class="pt-0.5">
                    <div class="w-[7px] h-[7px] rounded-full {dotClass(status)}"></div>
                  </div>
                  <div class="min-w-0">
                    <a href="/runtimes/{runtime.id}" class="text-[13px] text-text-secondary hover:text-text-primary transition-colors truncate block">
                      {runtime.title || "Untitled Runtime"}
                    </a>
                    <div class="text-[11px] font-mono text-text-placeholder truncate mt-0.5">{runtime.id}</div>
                  </div>
                  <div class="flex items-center gap-1.5 pt-0.5 shrink-0">
                    <span class="px-1.5 py-0.5 rounded-sm text-[10px] font-medium {statusClass(status)}">
                      {statusLabel(status)}
                    </span>
                  </div>
                  <div class="flex items-center gap-1 shrink-0">
                    {#if status === "hibernated"}
                      <button
                        class="p-1 rounded-sm text-text-tertiary hover:text-success-soft hover:bg-bg-hover-strong transition-colors"
                        onclick={() => handleWake(runtime.id)}
                        disabled={!!isBusy}
                        title="Wake"
                      >
                        {#if isBusy === "wake"}
                          <Loader2 class="w-3.5 h-3.5 animate-spin" />
                        {:else}
                          <Power class="w-3.5 h-3.5" />
                        {/if}
                      </button>
                      <button
                        class="p-1 rounded-sm text-text-tertiary hover:text-error-soft hover:bg-bg-hover-strong transition-colors"
                        onclick={() => handleDelete(runtime.id)}
                        disabled={!!isBusy}
                        title="Delete"
                      >
                        {#if isBusy === "delete"}
                          <Loader2 class="w-3.5 h-3.5 animate-spin" />
                        {:else}
                          <Trash2 class="w-3.5 h-3.5" />
                        {/if}
                      </button>
                    {/if}
                  </div>
                </div>

                <!-- Mobile: card layout -->
                <div class="lg:hidden px-3 py-3">
                  <div class="flex items-center gap-2 mb-2">
                    <div class="w-[7px] h-[7px] rounded-full shrink-0 {dotClass(status)}"></div>
                    <a href="/runtimes/{runtime.id}" class="flex-1 text-[13px] text-text-secondary hover:text-text-primary transition-colors truncate">
                      {runtime.title || "Untitled Runtime"}
                    </a>
                    <span class="px-1.5 py-0.5 rounded-sm text-[10px] font-medium shrink-0 {statusClass(status)}">
                      {statusLabel(status)}
                    </span>
                  </div>
                  <div class="text-[11px] font-mono text-text-placeholder truncate mb-2">{runtime.id}</div>
                  <div class="flex items-center gap-2">
                    {#if status === "hibernated"}
                      <button
                        class="flex items-center gap-1.5 px-2.5 py-1.5 rounded-[5px] bg-bg-code border border-border-subtle text-[12px] text-text-tertiary hover:text-success-soft hover:bg-bg-hover-strong transition-colors"
                        onclick={() => handleWake(runtime.id)}
                        disabled={!!isBusy}
                      >
                        {#if isBusy === "wake"}
                          <Loader2 class="w-3.5 h-3.5 animate-spin" />
                        {:else}
                          <Power class="w-3.5 h-3.5" />
                        {/if}
                        <span>Wake</span>
                      </button>
                      <button
                        class="flex items-center gap-1.5 px-2.5 py-1.5 rounded-[5px] bg-bg-code border border-border-subtle text-[12px] text-text-tertiary hover:text-error-soft hover:bg-bg-hover-strong transition-colors"
                        onclick={() => handleDelete(runtime.id)}
                        disabled={!!isBusy}
                      >
                        {#if isBusy === "delete"}
                          <Loader2 class="w-3.5 h-3.5 animate-spin" />
                        {:else}
                          <Trash2 class="w-3.5 h-3.5" />
                        {/if}
                        <span>Delete</span>
                      </button>
                    {/if}
                  </div>
                </div>
              </div>
            {/each}
            </div>
          </div>
        </div>
      {/if}
    {/if}
  </div>
</div>
