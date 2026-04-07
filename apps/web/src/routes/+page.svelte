<script lang="ts">
import { FolderKanban, Cpu, ArrowRight, Terminal, MessageSquare, Clock } from "lucide-svelte";
import { getWorkspaces, getRuntimes, getChannels } from "$lib/api";
import { getRuntimeStatusMeta } from "$lib/runtime-status";
import { onMount } from "svelte";
import { ensureAuth } from "$lib/auth";

let workspaceCount = $state(0);
let runtimeCount = $state(0);
let channelCount = $state(0);
let recentRuntimes = $state<Array<{ id: string; title: string; status: string; workspaceId?: string }>>([]);
let isLoading = $state(true);
let loadError = $state("");


onMount(async () => {
  if (!(await ensureAuth())) return;
  try {
    const [workspaces, runtimes, channels] = await Promise.all([
      getWorkspaces().catch(() => []),
      getRuntimes().catch(() => []),
      getChannels().catch(() => []),
    ]);
    workspaceCount = workspaces.length;
    runtimeCount = runtimes.length;
    channelCount = channels.length;
    recentRuntimes = runtimes
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .slice(0, 5)
      .map((r) => ({
        id: r.id,
        title: r.title || r.id.slice(0, 12),
        status: r.status ?? "unknown",
        workspaceId: r.workspaceId ?? undefined,
      }));
  } catch (error) {
    loadError = error instanceof Error ? error.message : "Failed to load overview data";
  } finally {
    isLoading = false;
  }
});
</script>

<div class="flex-1 flex flex-col min-h-0 overflow-y-auto">
  <div class="h-[40px] flex items-center px-4 border-b border-border-subtle shrink-0 bg-bg-primary">
    <span class="text-[11px] font-medium text-text-secondary">Overview</span>
  </div>

  <div class="flex-1 p-6 overflow-y-auto">
    <div class="max-w-[48rem]">
      <h1 class="text-xl font-semibold text-text-primary tracking-tight">Welcome to Cohub</h1>
      <p class="mt-1 text-[13px] text-text-tertiary">Host workspaces. Run agents.</p>
    </div>

    <!-- Quick Actions -->
    <div class="mt-6 flex flex-col sm:flex-row gap-2">
      <a href="/runtimes/new" class="flex items-center gap-2 px-3 py-2 rounded-md bg-[#FF3E00]/10 border border-[#FF3E00]/20 text-[13px] text-brand font-medium hover:bg-[#FF3E00]/15 transition-colors">
        <Terminal class="w-[14px] h-[14px]" />
        New Runtime
      </a>
      <a href="/workspaces" class="flex items-center gap-2 px-3 py-2 rounded-md bg-bg-surface border border-border-subtle text-[13px] text-text-secondary hover:text-text-primary hover:bg-bg-surface-hover transition-colors">
        <FolderKanban class="w-[14px] h-[14px]" />
        Workspaces
      </a>
      <a href="/explore" class="flex items-center gap-2 px-3 py-2 rounded-md bg-bg-surface border border-border-subtle text-[13px] text-text-secondary hover:text-text-primary hover:bg-bg-surface-hover transition-colors">
        <MessageSquare class="w-[14px] h-[14px]" />
        Explore
      </a>
    </div>

    {#if isLoading}
      <div class="mt-8 space-y-2">
        {#each [1, 2, 3] as _}
          <div class="h-10 rounded-md bg-bg-surface animate-pulse"></div>
        {/each}
      </div>
    {:else if loadError}
      <div class="mt-8 rounded-md border border-error-soft/30 bg-error-bg p-3 text-[12px] font-mono text-error-soft break-all">{loadError}</div>
    {:else}
      <!-- Summary Stats -->
      <div class="mt-8 grid grid-cols-3 gap-4">
        <div>
          <p class="text-2xl font-semibold text-text-primary tabular-nums">{workspaceCount}</p>
          <p class="text-[11px] text-text-tertiary mt-0.5">Workspaces</p>
        </div>
        <div>
          <p class="text-2xl font-semibold text-text-primary tabular-nums">{runtimeCount}</p>
          <p class="text-[11px] text-text-tertiary mt-0.5">Runtimes</p>
        </div>
        <div>
          <p class="text-2xl font-semibold text-text-primary tabular-nums">{channelCount}</p>
          <p class="text-[11px] text-text-tertiary mt-0.5">Channels</p>
        </div>
      </div>

      <!-- Recent Runtimes -->
      {#if recentRuntimes.length > 0}
        <div class="mt-8">
          <div class="flex items-center justify-between mb-3">
            <h2 class="text-[11px] font-semibold uppercase tracking-[0.1em] text-text-placeholder">Recent</h2>
            <a href="/runtimes" class="flex items-center gap-1 text-[11px] text-text-tertiary hover:text-text-secondary transition-colors">
              View all
              <ArrowRight class="w-3 h-3" />
            </a>
          </div>

          <div class="rounded-md border border-border-subtle overflow-hidden">
            {#each recentRuntimes as runtime, i}
              <a
                href="/runtimes/{runtime.id}"
                class="flex items-center gap-3 px-3 py-[10px] border-b border-border-subtle last:border-b-0 hover:bg-bg-hover transition-colors {i === 0 ? 'bg-bg-content' : ''}"
              >
                <div class="w-[6px] h-[6px] rounded-full shrink-0 {getRuntimeStatusMeta(runtime.status).textColorClass}"></div>
                <span class="flex-1 text-[13px] text-text-primary truncate">{runtime.title}</span>
                <span class="text-[11px] {getRuntimeStatusMeta(runtime.status).textColorClass}">{getRuntimeStatusMeta(runtime.status).label}</span>
                <ArrowRight class="w-3 h-3 text-text-placeholder opacity-0 group-hover:opacity-100" />
              </a>
            {/each}
          </div>
        </div>
      {/if}
    {/if}
  </div>
</div>
