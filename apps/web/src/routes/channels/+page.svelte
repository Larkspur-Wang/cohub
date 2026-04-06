<script lang="ts">
import { Plus, Trash2, Webhook, MessageSquare, MonitorPlay, X, Box } from "lucide-svelte";
import { createChannel, deleteChannel, getChannels, type Channel } from "$lib/api";
import { fade } from "svelte/transition";
import { onMount } from "svelte";
import { ensureAuth, logtoClient } from "$lib/auth";

let channels = $state<Channel[]>([]);
let isLoading = $state(true);
let loadError = $state("");

let isAdding = $state(false);
let isSubmitting = $state(false);

let formProvider = $state("discord");
let formName = $state("");
let formToken = $state("");

const providerIcons: Record<string, typeof MessageSquare> = {
  discord: MessageSquare,
  feishu: Webhook,
  web: MonitorPlay,
};

const providerColors: Record<string, string> = {
  discord: "text-indigo-400/70 bg-indigo-500/10 border-indigo-500/20",
  feishu: "text-cyan-400/70 bg-cyan-500/10 border-cyan-500/20",
  web: "text-emerald-400/70 bg-emerald-500/10 border-emerald-500/20",
};

async function loadChannels() {
  if (!(await ensureAuth())) return;
  isLoading = true;
  loadError = "";
  try {
    channels = await getChannels();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load channels";
    if (message.includes("unauthorized") || message.includes("401")) {
      await logtoClient.signIn(`${window.location.origin}/callback`);
      return;
    }
    loadError = message;
  } finally {
    isLoading = false;
  }
}

onMount(() => {
  loadChannels();
});

async function handleSubmit(e: Event) {
  e.preventDefault();
  if (!formName.trim() || !formToken.trim() || isSubmitting) return;

  isSubmitting = true;
  try {
    await createChannel({
      provider: formProvider,
      name: formName.trim(),
      credentials: { token: formToken.trim() },
    });
    isAdding = false;
    formName = "";
    formToken = "";
    await loadChannels();
  } catch (error) {
    alert(error instanceof Error ? error.message : "Failed to create channel");
  } finally {
    isSubmitting = false;
  }
}

async function handleDelete(id: string) {
  if (!confirm("Are you sure you want to delete this channel?")) return;
  try {
    await deleteChannel(id);
    await loadChannels();
  } catch (error) {
    alert(error instanceof Error ? error.message : "Failed to delete channel");
  }
}
</script>

<div class="flex-1 flex flex-col min-h-0 overflow-y-auto">
  <!-- Header -->
  <div class="h-10 flex items-center justify-between px-4 border-b border-white/10 shrink-0 bg-[#0A0A0A]">
    <span class="text-xs font-medium text-white/60">Channels</span>
    <button
      type="button"
      class="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs text-white/60 hover:text-white hover:bg-white/8 transition-colors"
      onclick={() => isAdding = true}
    >
      <Plus class="w-3.5 h-3.5" />
      Add Channel
    </button>
  </div>

  <div class="flex-1 p-4 overflow-y-auto">
    <!-- Create Form -->
    {#if isAdding}
      <div class="mb-4 border border-white/10 rounded-lg bg-[#121212] p-4" in:fade>
        <div class="flex items-center justify-between mb-4">
          <h2 class="text-sm font-medium text-white/90">New Channel</h2>
          <button onclick={() => isAdding = false} class="text-white/30 hover:text-white/70 transition-colors">
            <X class="w-4 h-4" />
          </button>
        </div>

        <form onsubmit={handleSubmit} class="space-y-3">
          <div class="grid grid-cols-3 gap-3">
            <div>
              <label class="block text-[10px] font-medium uppercase tracking-wider text-white/40 mb-1.5" for="ch-provider">Platform</label>
              <select
                id="ch-provider"
                bind:value={formProvider}
                class="w-full px-3 py-1.5 rounded-md bg-black/40 border border-white/10 text-xs text-white focus:border-white/30 focus:outline-none"
              >
                <option value="discord">Discord</option>
                <option value="feishu">Feishu</option>
                <option value="web">Web Widget</option>
              </select>
            </div>

            <div>
              <label class="block text-[10px] font-medium uppercase tracking-wider text-white/40 mb-1.5" for="ch-name">Name</label>
              <input
                id="ch-name"
                type="text"
                bind:value={formName}
                placeholder="Support Bot"
                class="w-full px-3 py-1.5 rounded-md bg-black/40 border border-white/10 text-xs text-white placeholder:text-white/20 focus:border-white/30 focus:outline-none"
                required
              />
            </div>

            <div>
              <label class="block text-[10px] font-medium uppercase tracking-wider text-white/40 mb-1.5" for="ch-token">Bot Token</label>
              <input
                id="ch-token"
                type="password"
                bind:value={formToken}
                placeholder="Enter token..."
                class="w-full px-3 py-1.5 rounded-md bg-black/40 border border-white/10 text-xs text-white placeholder:text-white/20 focus:border-white/30 focus:outline-none"
                required
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            class="px-4 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-500 text-xs text-white font-medium transition-colors disabled:opacity-50"
          >
            {isSubmitting ? "Saving..." : "Save Channel"}
          </button>
        </form>
      </div>
    {/if}

    <!-- Channel List -->
    {#if isLoading}
      <div class="flex items-center justify-center py-12 text-xs text-white/30">
        <div class="w-4 h-4 rounded-full border-2 border-white/15 border-t-emerald-400 animate-spin mr-2"></div>
        Loading channels...
      </div>
    {:else if loadError}
      <div class="rounded-md border border-rose-500/20 bg-rose-500/10 p-3 text-xs font-mono text-rose-400 break-all">{loadError}</div>
    {:else if channels.length === 0}
      <div class="flex flex-col items-center justify-center py-12 text-center">
        <div class="w-10 h-10 rounded-full bg-white/5 border border-white/10 flex items-center justify-center mb-3">
          <Webhook class="w-4 h-4 text-white/20" />
        </div>
        <p class="text-sm text-white/40">No channels yet</p>
        <p class="text-xs text-white/25 mt-1">Connect a platform to let your agents communicate</p>
      </div>
    {:else}
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {#each channels as channel (channel.id)}
          {@const Icon = providerIcons[channel.provider] || Webhook}
          {@const colorClass = providerColors[channel.provider] || providerColors.web}
          <div class="group p-3 rounded-lg border border-white/10 bg-[#121212] hover:border-white/20 transition-colors">
            <div class="flex items-start justify-between gap-2 mb-2">
              <div class="w-8 h-8 rounded-md {colorClass} border flex items-center justify-center shrink-0">
                <Icon class="w-4 h-4" />
              </div>
              <div class="flex items-center gap-1.5">
                <span class="px-1.5 py-0.5 rounded text-[10px] bg-emerald-500/10 text-emerald-400/70 border border-emerald-500/20">{channel.status}</span>
                <button
                  onclick={() => handleDelete(channel.id)}
                  class="p-1 rounded text-white/20 hover:text-rose-400 hover:bg-rose-500/10 opacity-0 group-hover:opacity-100 transition-all"
                  title="Delete channel"
                >
                  <Trash2 class="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            <h3 class="text-sm font-medium text-white/90 truncate">{channel.name}</h3>
            <p class="mt-0.5 text-[10px] uppercase tracking-wider text-white/30">{channel.provider}</p>

            {#if channel.boundRuntime}
              <div class="mt-2 flex items-center gap-1.5 text-[10px] text-white/30">
                <Box class="w-3 h-3 shrink-0" />
                <span>Bound to:</span>
                <a href="/runtimes/{channel.boundRuntime.id}" class="text-white/50 hover:text-white/80 truncate font-mono">
                  {channel.boundRuntime.title || channel.boundRuntime.id.slice(0, 8)}
                </a>
              </div>
            {:else}
              <div class="mt-2 flex items-center gap-1.5 text-[10px] text-white/20">
                <Box class="w-3 h-3 shrink-0" />
                <span>Not bound to any runtime</span>
              </div>
            {/if}

            <div class="mt-2 pt-2 border-t border-white/5 text-[10px] text-white/20 font-mono">
              ID: {channel.id.slice(0, 8)}...
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </div>
</div>
