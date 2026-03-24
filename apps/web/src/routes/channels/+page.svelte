<script lang="ts">
import { Plus, Trash2, Webhook, MessageSquare, MonitorPlay } from "lucide-svelte";
import { createChannel, deleteChannel, getChannels, type Channel } from "$lib/api";
import { fade } from "svelte/transition";
import { onMount } from "svelte";
import { goto } from "$app/navigation";

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
  isLoading = true;
  loadError = "";
  try {
    channels = await getChannels();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load channels";
    if (message.includes("unauthorized") || message.includes("401")) {
      goto("/login");
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

<div class="space-y-8">
  <div class="flex items-center justify-between">
    <div>
      <h1 class="text-3xl font-bold tracking-tight text-gray-900">Channels</h1>
      <p class="mt-2 text-sm text-gray-500">Manage connections to external messaging platforms.</p>
    </div>
    <button
      onclick={() => (isAdding = true)}
      class="px-4 py-2 bg-brand text-white text-sm font-medium rounded-xl hover:bg-brand/90 transition-colors shadow-sm flex items-center gap-2"
    >
      <Plus class="w-4 h-4" />
      Add Channel
    </button>
  </div>

  {#if isAdding}
    <div transition:fade class="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm mb-8">
      <div class="flex items-center justify-between mb-6">
        <h2 class="text-lg font-semibold text-gray-900">New Channel</h2>
        <button onclick={() => (isAdding = false)} class="text-sm text-gray-500 hover:text-gray-900">Cancel</button>
      </div>

      <form onsubmit={handleSubmit} class="space-y-4 max-w-md">
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1" for="provider">Platform</label>
          <select
            id="provider"
            bind:value={formProvider}
            class="w-full px-4 py-2 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-brand focus:border-brand outline-none"
          >
            <option value="discord">Discord</option>
            <option value="feishu">Feishu</option>
            <option value="web">Web Widget</option>
          </select>
        </div>

        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1" for="name">Channel Name</label>
          <input
            type="text"
            id="name"
            bind:value={formName}
            placeholder="e.g. My Support Bot"
            class="w-full px-4 py-2 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-brand focus:border-brand outline-none"
            required
          />
        </div>

        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1" for="token">Bot Token / Secret</label>
          <input
            type="password"
            id="token"
            bind:value={formToken}
            placeholder="Enter token..."
            class="w-full px-4 py-2 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-brand focus:border-brand outline-none"
            required
          />
        </div>

        <button
          type="submit"
          disabled={isSubmitting}
          class="w-full py-2.5 bg-gray-900 text-white font-medium rounded-xl hover:bg-gray-800 transition-colors disabled:opacity-50"
        >
          {isSubmitting ? "Saving..." : "Save Channel"}
        </button>
      </form>
    </div>
  {/if}

  {#if isLoading}
    <div class="bg-white border border-gray-200 rounded-2xl p-8 text-sm text-gray-500">Loading channels...</div>
  {:else if loadError}
    <div class="bg-red-50 border border-red-200 text-red-700 p-6 rounded-2xl">
      <h2 class="text-lg font-semibold mb-2">Failed to load channels</h2>
      <p class="text-sm break-all">{loadError}</p>
    </div>
  {:else if channels.length === 0}
    <div class="text-center py-16 bg-white border border-gray-200 border-dashed rounded-3xl">
      <div class="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-4">
        <Webhook class="w-8 h-8 text-gray-400" />
      </div>
      <h3 class="text-lg font-medium text-gray-900 mb-1">No channels yet</h3>
      <p class="text-sm text-gray-500 mb-4">Connect a platform to let your agents communicate.</p>
      <button onclick={() => (isAdding = true)} class="text-brand text-sm font-medium hover:underline">
        Add your first channel
      </button>
    </div>
  {:else}
    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {#each channels as channel}
        {@const Icon = providerIcons[channel.provider] || Webhook}
        <div class="bg-white rounded-2xl border border-gray-200 shadow-sm p-5 flex flex-col group hover:border-brand/30 transition-colors">
          <div class="flex items-start justify-between mb-4">
            <div class="w-10 h-10 rounded-xl bg-gray-50 text-gray-700 flex items-center justify-center">
              <Icon class="w-5 h-5" />
            </div>
            <div class="flex items-center gap-2">
              <span class="px-2 py-1 bg-green-50 text-green-700 text-xs font-medium rounded-md capitalize">
                {channel.status}
              </span>
              <button
                onclick={() => handleDelete(channel.id)}
                class="p-1.5 text-gray-400 hover:text-red-500 rounded-lg hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-all"
                title="Delete channel"
              >
                <Trash2 class="w-4 h-4" />
              </button>
            </div>
          </div>
          <h3 class="text-lg font-semibold text-gray-900 truncate">{channel.name}</h3>
          <p class="text-sm text-gray-500 capitalize">{channel.provider}</p>
          <div class="mt-4 pt-4 border-t border-gray-100 text-xs text-gray-400 flex items-center justify-between">
            <span class="truncate">ID: {channel.id.slice(0, 8)}...</span>
            <span>{new Date(channel.createdAt).toLocaleDateString()}</span>
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>
