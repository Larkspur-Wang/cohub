<script lang="ts">
import { goto } from "$app/navigation";
import { onMount } from "svelte";
import {
  createRuntime,
  getChannels,
  getWorkspaceByUser,
  type Channel,
  type RuntimeChannelBindingInput,
  type WorkspaceDetail,
} from "$lib/api";

let { params } = $props();

let workspace = $state<WorkspaceDetail | null>(null);
let channels = $state<Channel[]>([]);
let isLoading = $state(true);
let isSubmitting = $state(false);
let loadError = $state("");
let submitError = $state("");

let title = $state("");
let startNow = $state(true);
let selectedChannelIds = $state<string[]>([]);

async function loadPage() {
  isLoading = true;
  loadError = "";

  try {
    const [workspaceData, channelsData] = await Promise.all([
      getWorkspaceByUser(params.owner, params.repo),
      getChannels(),
    ]);

    workspace = workspaceData;
    channels = channelsData;
    title = workspaceData.name;
  } catch (error) {
    loadError = error instanceof Error ? error.message : "Failed to load runtime form";
  } finally {
    isLoading = false;
  }
}

onMount(() => {
  loadPage();
});

function toggleChannel(channelId: string, checked: boolean) {
  if (checked) {
    if (!selectedChannelIds.includes(channelId)) {
      selectedChannelIds = [...selectedChannelIds, channelId];
    }
    return;
  }

  selectedChannelIds = selectedChannelIds.filter((id) => id !== channelId);
}

async function handleSubmit(event: SubmitEvent) {
  event.preventDefault();
  if (!workspace || isSubmitting) return;

  submitError = "";
  isSubmitting = true;

  try {
    const channelBindings: RuntimeChannelBindingInput[] = selectedChannelIds.map((channelId) => ({
      channelId,
    }));

    const result = await createRuntime({
      workspaceId: workspace.id,
      title: title.trim() || workspace.name,
      start: startNow,
      channelBindings,
    });

    await goto(`/runtimes/${result.runtime.id}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create runtime";
    if (message.includes("channel binding already exists") || message.includes("409")) {
      submitError = "This channel is already bound to another runtime. Please choose a different channel or reuse the existing runtime.";
    } else {
      submitError = message;
    }
  } finally {
    isSubmitting = false;
  }
}
</script>

<div class="space-y-8 max-w-4xl">
  <div>
    <h1 class="text-3xl font-bold tracking-tight text-gray-900">New Runtime</h1>
    <p class="mt-2 text-sm text-gray-500">Create a runtime from this workspace and optionally bind multiple channels.</p>
  </div>

  {#if isLoading}
    <div class="bg-white border border-gray-200 rounded-2xl p-8 text-sm text-gray-500">Loading runtime form...</div>
  {:else if loadError}
    <div class="bg-red-50 border border-red-200 text-red-700 p-6 rounded-2xl">
      <h2 class="text-lg font-semibold mb-2">Failed to load runtime form</h2>
      <p class="text-sm break-all">{loadError}</p>
    </div>
  {:else if workspace}
    <form onsubmit={handleSubmit} class="space-y-6">
      <div class="bg-white border border-gray-200 rounded-2xl shadow-sm p-6 space-y-4">
        <div>
          <div class="text-xs uppercase tracking-[0.2em] font-black text-brand">Workspace</div>
          <h2 class="mt-2 text-xl font-semibold text-gray-900">{workspace.name}</h2>
          <p class="mt-1 text-sm text-gray-500">{workspace.fullName}</p>
        </div>

        <div class="grid gap-4 md:grid-cols-1">
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1" for="title">Runtime title</label>
            <input
              id="title"
              bind:value={title}
              type="text"
              placeholder="Enter runtime title"
              class="w-full px-4 py-2 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-brand focus:border-brand outline-none"
            />
          </div>
        </div>

        <label class="flex items-center gap-3 text-sm text-gray-700">
          <input bind:checked={startNow} type="checkbox" class="rounded border-gray-300 text-brand focus:ring-brand" />
          Start runtime immediately after creation
        </label>
      </div>

      <div class="bg-white border border-gray-200 rounded-2xl shadow-sm p-6 space-y-4">
        <div>
          <div class="text-xs uppercase tracking-[0.2em] font-black text-brand">Channel bindings</div>
          <h2 class="mt-2 text-xl font-semibold text-gray-900">Bind channels to this runtime</h2>
          <p class="mt-1 text-sm text-gray-500">You can leave this empty, or select multiple channels to connect now.</p>
        </div>

        {#if channels.length === 0}
          <div class="rounded-xl border border-dashed border-gray-200 p-4 text-sm text-gray-500">
            No channels available yet. You can still create a runtime without bindings.
          </div>
        {:else}
          <div class="space-y-4">
            {#each channels as channel}
              {@const checked = selectedChannelIds.includes(channel.id)}
              <div class="rounded-xl border border-gray-200 p-4 space-y-3">
                <label class="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={checked}
                    onchange={(event) =>
                      toggleChannel(channel.id, (event.currentTarget as HTMLInputElement).checked)}
                    class="mt-1 rounded border-gray-300 text-brand focus:ring-brand"
                  />
                  <div class="min-w-0 flex-1">
                    <div class="flex items-center gap-2 flex-wrap">
                      <span class="font-medium text-gray-900">{channel.name}</span>
                      <span class="px-2 py-0.5 text-xs bg-gray-100 text-gray-600 rounded-md capitalize">{channel.provider}</span>
                      <span class="px-2 py-0.5 text-xs bg-green-50 text-green-700 rounded-md capitalize">{channel.status}</span>
                    </div>
                    <div class="mt-1 text-xs text-gray-500 break-all">{channel.id}</div>
                  </div>
                </label>
              </div>
            {/each}
          </div>
        {/if}
      </div>

      {#if submitError}
        <div class="bg-red-50 border border-red-200 text-red-700 p-4 rounded-2xl text-sm break-all">
          {submitError}
        </div>
      {/if}

      <div class="flex items-center gap-3">
        <button
          type="submit"
          disabled={isSubmitting}
          class="px-5 py-2.5 bg-brand text-white text-sm font-medium rounded-xl hover:bg-brand/90 transition-colors shadow-sm disabled:opacity-50"
        >
          {isSubmitting ? "Creating runtime..." : "Create Runtime"}
        </button>
        <button
          type="button"
          onclick={() => goto(`/workspaces/${params.owner}/${params.repo}`)}
          class="px-5 py-2.5 border border-gray-200 text-sm font-medium rounded-xl hover:bg-gray-50 transition-colors"
        >
          Cancel
        </button>
      </div>
    </form>
  {/if}
</div>
