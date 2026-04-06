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

const providerDotColor: Record<string, string> = {
  discord: "bg-indigo-400",
  feishu: "bg-cyan-400",
  web: "bg-status-running",
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
  <div class="h-[40px] flex items-center justify-between px-4 border-b border-border-subtle shrink-0 bg-bg-primary">
    <span class="text-[11px] font-medium text-text-secondary">Channels</span>
    <button
      type="button"
      class="flex items-center gap-1.5 px-2.5 py-1 rounded-[5px] text-[12px] bg-[#FF3E00]/10 border border-[#FF3E00]/20 text-brand font-medium hover:bg-[#FF3E00]/15 transition-colors"
      onclick={() => isAdding = true}
    >
      <Plus class="w-3.5 h-3.5" />
      Add Channel
    </button>
  </div>

  <div class="flex-1 p-4 overflow-y-auto">
    <!-- Create Form -->
    {#if isAdding}
      <div class="mb-4 border border-border-subtle rounded-md bg-bg-surface p-4" in:fade>
        <div class="flex items-center justify-between mb-4">
          <h2 class="text-[13px] font-medium text-text-primary">New Channel</h2>
          <button onclick={() => isAdding = false} class="text-text-tertiary hover:text-text-secondary transition-colors">
            <X class="w-4 h-4" />
          </button>
        </div>

        <form onsubmit={handleSubmit} class="space-y-3">
          <div class="grid grid-cols-3 gap-3">
            <div>
              <label class="block text-[10px] font-medium uppercase tracking-wider text-text-tertiary mb-1.5" for="ch-provider">Platform</label>
              <select
                id="ch-provider"
                bind:value={formProvider}
                class="w-full px-3 py-[6px] rounded-[5px] bg-bg-input border border-border-subtle text-[13px] text-text-primary focus:border-brand/40 focus:outline-none transition-colors"
              >
                <option value="discord">Discord</option>
                <option value="feishu">Feishu</option>
                <option value="web">Web Widget</option>
              </select>
            </div>

            <div>
              <label class="block text-[10px] font-medium uppercase tracking-wider text-text-tertiary mb-1.5" for="ch-name">Name</label>
              <input
                id="ch-name"
                type="text"
                bind:value={formName}
                placeholder="Support Bot"
                class="w-full px-3 py-[6px] rounded-[5px] bg-bg-input border border-border-subtle text-[13px] text-text-primary placeholder:text-text-placeholder focus:border-brand/40 focus:outline-none transition-colors"
                required
              />
            </div>

            <div>
              <label class="block text-[10px] font-medium uppercase tracking-wider text-text-tertiary mb-1.5" for="ch-token">Bot Token</label>
              <input
                id="ch-token"
                type="password"
                bind:value={formToken}
                placeholder="Enter token..."
                class="w-full px-3 py-[6px] rounded-[5px] bg-bg-input border border-border-subtle text-[13px] text-text-primary placeholder:text-text-placeholder focus:border-brand/40 focus:outline-none transition-colors"
                required
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            class="px-4 py-[6px] rounded-[5px] bg-[#FF3E00] hover:bg-brand-hover text-[12px] text-white font-medium transition-colors disabled:opacity-50"
          >
            {isSubmitting ? "Saving..." : "Save Channel"}
          </button>
        </form>
      </div>
    {/if}

    <!-- Channel List -->
    {#if isLoading}
      <div class="flex items-center justify-center py-12 text-[12px] text-text-tertiary">
        <div class="w-4 h-4 rounded-full border-2 border-border-subtle border-t-brand animate-spin mr-2"></div>
        Loading channels...
      </div>
    {:else if loadError}
      <div class="rounded-md border border-error-soft/30 bg-error-bg p-3 text-[12px] font-mono text-error-soft break-all">{loadError}</div>
    {:else if channels.length === 0}
      <div class="flex flex-col items-center justify-center py-16 text-center">
        <div class="w-11 h-11 rounded-md bg-bg-surface border border-border-subtle flex items-center justify-center mb-3">
          <Webhook class="w-5 h-5 text-text-placeholder" />
        </div>
        <p class="text-[14px] text-text-tertiary">No channels yet</p>
        <p class="text-[12px] text-text-placeholder mt-1">Connect a platform to let your agents communicate</p>
      </div>
    {:else}
      <div class="rounded-md border border-border-subtle overflow-hidden">
        <div class="grid grid-cols-[auto_1fr_auto_1fr_auto] gap-3 px-3 py-2 bg-bg-header-alt text-[10px] font-medium uppercase tracking-[0.08em] text-text-placeholder border-b border-border-subtle">
          <span></span>
          <span>Channel</span>
          <span>Status</span>
          <span>Bound Runtime</span>
          <span></span>
        </div>
        {#each channels as channel (channel.id)}
          {@const Icon = providerIcons[channel.provider] || Webhook}
          {@const dotColor = providerDotColor[channel.provider] || providerDotColor.web}
          <div class="group grid grid-cols-[auto_1fr_auto_1fr_auto] gap-3 px-3 py-2.5 border-b border-border-subtle last:border-b-0 hover:bg-bg-hover transition-colors duration-100">
            <div class="w-7 h-7 rounded-[5px] bg-bg-surface border border-border-subtle flex items-center justify-center shrink-0 mt-0.5">
              <div class="w-2 h-2 rounded-full {dotColor} mr-0.5"></div>
              <Icon class="w-3.5 h-3.5 text-text-tertiary" />
            </div>
            <div class="min-w-0">
              <div class="text-[13px] font-medium text-text-primary truncate">{channel.name}</div>
              <div class="text-[10px] uppercase tracking-wider text-text-tertiary">{channel.provider}</div>
            </div>
            <div class="flex items-center pt-0.5 shrink-0">
              <span class="px-1.5 py-0.5 rounded-sm text-[10px] bg-bg-hover text-text-tertiary border border-border-subtle">{channel.status}</span>
            </div>
            <div class="flex items-center gap-1.5 pt-0.5 min-w-0">
              {#if channel.boundRuntime}
                <Box class="w-3 h-3 shrink-0 text-text-placeholder" />
                <a href="/runtimes/{channel.boundRuntime.id}" class="text-[12px] text-text-secondary hover:text-text-primary truncate font-mono transition-colors">
                  {channel.boundRuntime.title || channel.boundRuntime.id.slice(0, 8)}
                </a>
              {:else}
                <Box class="w-3 h-3 shrink-0 text-text-placeholder" />
                <span class="text-[12px] text-text-placeholder">Not bound</span>
              {/if}
            </div>
            <div class="flex items-center justify-end pt-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
              <button
                onclick={() => handleDelete(channel.id)}
                class="p-1.5 rounded-[4px] text-text-tertiary hover:text-error-soft hover:bg-error-bg transition-colors"
                title="Delete channel"
              >
                <Trash2 class="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </div>
</div>
