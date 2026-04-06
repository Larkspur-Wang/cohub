<script lang="ts">
import { FolderKanban, Network, Cpu, ArrowRight } from "lucide-svelte";
import { getWorkspaces, getRuntimes, getChannels } from "$lib/api";
import { onMount } from "svelte";
import { ensureAuth } from "$lib/auth";

let workspaceCount = $state(0);
let runtimeCount = $state(0);
let channelCount = $state(0);
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
  } catch (error) {
    loadError = error instanceof Error ? error.message : "Failed to load overview data";
  } finally {
    isLoading = false;
  }
});
</script>

<div class="flex-1 flex flex-col min-h-0 overflow-y-auto">
  <div class="h-10 flex items-center px-4 border-b border-white/10 shrink-0 bg-[#0A0A0A]">
    <span class="text-xs font-medium text-white/60">Overview</span>
  </div>

  <div class="flex-1 p-6 overflow-y-auto">
    <div class="max-w-3xl">
      <h1 class="text-2xl font-semibold text-white/90 tracking-tight">Welcome to Cohub</h1>
      <p class="mt-2 text-sm text-white/40">Orchestrate your autonomous AI workflows.</p>
    </div>

    {#if isLoading}
      <div class="mt-6 grid grid-cols-3 gap-3">
        {#each [1, 2, 3] as _}
          <div class="h-24 rounded-lg border border-white/10 bg-[#121212] animate-pulse"></div>
        {/each}
      </div>
    {:else if loadError}
      <div class="mt-6 rounded-md border border-rose-500/20 bg-rose-500/10 p-3 text-xs font-mono text-rose-400 break-all">{loadError}</div>
    {:else}
      <div class="mt-6 grid grid-cols-1 sm:grid-cols-3 gap-3">
        <a href="/workspaces" class="block p-4 rounded-lg border border-white/10 bg-[#121212] hover:border-white/20 hover:bg-[#161616] transition-colors group">
          <div class="flex items-center justify-between mb-3">
            <div class="w-8 h-8 rounded-md bg-blue-500/10 border border-blue-500/20 flex items-center justify-center">
              <FolderKanban class="w-4 h-4 text-blue-400/70" />
            </div>
            <ArrowRight class="w-4 h-4 text-white/20 group-hover:text-white/50 group-hover:translate-x-0.5 transition-all" />
          </div>
          <p class="text-2xl font-semibold text-white/90">{workspaceCount}</p>
          <p class="text-xs text-white/35 mt-1">Workspaces</p>
        </a>

        <a href="/runtimes" class="block p-4 rounded-lg border border-white/10 bg-[#121212] hover:border-white/20 hover:bg-[#161616] transition-colors group">
          <div class="flex items-center justify-between mb-3">
            <div class="w-8 h-8 rounded-md bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
              <Cpu class="w-4 h-4 text-emerald-400/70" />
            </div>
            <ArrowRight class="w-4 h-4 text-white/20 group-hover:text-white/50 group-hover:translate-x-0.5 transition-all" />
          </div>
          <p class="text-2xl font-semibold text-white/90">{runtimeCount}</p>
          <p class="text-xs text-white/35 mt-1">Runtimes</p>
        </a>

        <a href="/channels" class="block p-4 rounded-lg border border-white/10 bg-[#121212] hover:border-white/20 hover:bg-[#161616] transition-colors group">
          <div class="flex items-center justify-between mb-3">
            <div class="w-8 h-8 rounded-md bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center">
              <Network class="w-4 h-4 text-indigo-400/70" />
            </div>
            <ArrowRight class="w-4 h-4 text-white/20 group-hover:text-white/50 group-hover:translate-x-0.5 transition-all" />
          </div>
          <p class="text-2xl font-semibold text-white/90">{channelCount}</p>
          <p class="text-xs text-white/35 mt-1">Channels</p>
        </a>
      </div>
    {/if}

    <!-- Quick links -->
    <div class="mt-8">
      <h2 class="text-sm font-medium text-white/50 mb-3">Quick Links</h2>
      <div class="space-y-1">
        <a href="/workspaces" class="flex items-center gap-2 px-3 py-2 rounded-md text-xs text-white/50 hover:text-white/80 hover:bg-white/5 transition-colors">
          <ArrowRight class="w-3 h-3" />
          Browse workspaces
        </a>
        <a href="/explore" class="flex items-center gap-2 px-3 py-2 rounded-md text-xs text-white/50 hover:text-white/80 hover:bg-white/5 transition-colors">
          <ArrowRight class="w-3 h-3" />
          Explore public workspaces
        </a>
        <a href="/channels" class="flex items-center gap-2 px-3 py-2 rounded-md text-xs text-white/50 hover:text-white/80 hover:bg-white/5 transition-colors">
          <ArrowRight class="w-3 h-3" />
          Manage channels
        </a>
        <a href="/settings" class="flex items-center gap-2 px-3 py-2 rounded-md text-xs text-white/50 hover:text-white/80 hover:bg-white/5 transition-colors">
          <ArrowRight class="w-3 h-3" />
          Settings
        </a>
      </div>
    </div>
  </div>
</div>
