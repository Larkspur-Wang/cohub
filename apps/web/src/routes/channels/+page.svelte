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

const providerIcons: Record<string, typeof import("lucide-svelte").MessageSquare> = {
  discord: MessageSquare,
  feishu: Webhook,
  web: MonitorPlay,
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

<div class="neo-page-shell">
  <div class="neo-page-header">
    <div>
      <h1 class="neo-page-title">Channels</h1>
      <p class="neo-page-desc mt-3 max-w-2xl">Manage connections to external messaging platforms and control how agents communicate.</p>
    </div>
    <button onclick={() => (isAdding = true)} class="neo-btn neo-btn-primary">
      <Plus class="w-4 h-4" />
      Add Channel
    </button>
  </div>

  {#if isAdding}
    <div transition:fade class="neo-card p-5 md:p-6 bg-white">
      <div class="flex items-center justify-between gap-4 mb-5">
        <div>
          <h2 class="neo-section-title">New Channel</h2>
          <p class="neo-page-desc mt-2 text-sm">Connect Discord, Feishu, or web widget access.</p>
        </div>
        <button onclick={() => (isAdding = false)} class="neo-btn neo-btn-secondary !px-3 !py-2">
          <X class="w-4 h-4" />
          Close
        </button>
      </div>

      <form onsubmit={handleSubmit} class="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <label class="neo-meta mb-2 block" for="provider">Platform</label>
          <select id="provider" bind:value={formProvider} class="neo-input">
            <option value="discord">Discord</option>
            <option value="feishu">Feishu</option>
            <option value="web">Web Widget</option>
          </select>
        </div>

        <div>
          <label class="neo-meta mb-2 block" for="name">Channel Name</label>
          <input type="text" id="name" bind:value={formName} placeholder="Support Bot" class="neo-input" required />
        </div>

        <div>
          <label class="neo-meta mb-2 block" for="token">Bot Token / Secret</label>
          <input type="password" id="token" bind:value={formToken} placeholder="Enter token..." class="neo-input" required />
        </div>

        <div class="md:col-span-3">
          <button type="submit" disabled={isSubmitting} class="neo-btn neo-btn-primary disabled:opacity-50">
            {isSubmitting ? "Saving..." : "Save Channel"}
          </button>
        </div>
      </form>
    </div>
  {/if}

  {#if isLoading}
    <div class="neo-loading">Loading channels...</div>
  {:else if loadError}
    <div class="neo-error">
      <h2 class="neo-section-title text-white">Load Failed</h2>
      <p class="mt-2 text-sm font-bold break-all">{loadError}</p>
    </div>
  {:else if channels.length === 0}
    <div class="neo-empty">
      <div class="neo-icon-box neo-fill-yellow mx-auto mb-4"><Webhook class="w-5 h-5" /></div>
      <h3 class="neo-section-title">No Channels Yet</h3>
      <p class="neo-page-desc mt-3 text-sm">Connect a platform to let your agents communicate.</p>
    </div>
  {:else}
    <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
      {#each channels as channel}
        {@const Icon = providerIcons[channel.provider] || Webhook}
        <div class="neo-list-card p-4 bg-white flex flex-col gap-4 group">
          <div class="flex items-start justify-between gap-3">
            <div class="neo-icon-box neo-fill-yellow"><Icon class="w-5 h-5" /></div>
            <div class="flex items-center gap-2">
              <span class="neo-badge neo-badge-green">{channel.status}</span>
              <button
                onclick={() => handleDelete(channel.id)}
                class="neo-btn neo-btn-secondary !px-2.5 !py-2 opacity-0 group-hover:opacity-100"
                title="Delete channel"
              >
                <Trash2 class="w-4 h-4" />
              </button>
            </div>
          </div>
          <div>
            <h3 class="text-lg font-black uppercase tracking-tight truncate">{channel.name}</h3>
            <p class="mt-1 text-xs font-bold uppercase tracking-widest text-black/60">{channel.provider}</p>
          </div>
          {#if channel.boundRuntime}
            <div class="flex items-center gap-2 text-xs">
              <Box class="w-3.5 h-3.5 text-black/50" />
              <span class="text-black/60">Bound to:</span>
              <a href="/runtimes/{channel.boundRuntime.id}" class="font-bold text-black hover:underline truncate">
                {channel.boundRuntime.title || 'Untitled Runtime'}
              </a>
              <span class="neo-badge neo-badge-xs {channel.boundRuntime.status === 'running' ? 'neo-badge-green' : channel.boundRuntime.status === 'deleted' ? 'neo-badge-red' : 'neo-badge-gray'}">
                {channel.boundRuntime.status}
              </span>
            </div>
          {:else}
            <div class="flex items-center gap-2 text-xs text-black/40">
              <Box class="w-3.5 h-3.5" />
              <span>Not bound to any runtime</span>
            </div>
          {/if}
          <div class="mt-auto flex items-center justify-between gap-3 border-t-[3px] border-black pt-3 text-[11px] font-bold text-black/55">
            <span class="truncate">ID: {channel.id.slice(0, 8)}...</span>
            <span>{new Date(channel.createdAt).toLocaleDateString()}</span>
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>
