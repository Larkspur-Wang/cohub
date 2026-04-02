<script lang="ts">
import { goto } from "$app/navigation";
import { onMount } from "svelte";
import {
  createRuntime,
  getChannels,
  getWorkspaceById,
  type Channel,
  type RuntimeChannelBindingInput,
  type RuntimeChannelConfigInput,
  type RuntimeEnvInput,
  type WorkspaceDetail,
} from "$lib/api";
import { ensureAuth } from "$lib/auth";

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
let extraEnv = $state<RuntimeEnvInput[]>([]);
let channelConfigById = $state<Record<string, RuntimeChannelConfigInput>>({});

const getDefaultChannelConfig = (channel: Channel): RuntimeChannelConfigInput => {
  if (channel.provider === "discord") {
    return {
      inbound: {
        requireMentionInGuild: false,
      },
      outbound: {
        showThinking: true,
        showToolCalls: true,
      },
    };
  }

  return {};
};

async function loadPage() {
  if (!(await ensureAuth())) return;
  isLoading = true;
  loadError = "";

  try {
    const [workspaceData, channelsData] = await Promise.all([
      getWorkspaceById(params.id),
      getChannels(),
    ]);

    workspace = workspaceData;
    channels = channelsData;
    title = workspaceData.name;
    channelConfigById = Object.fromEntries(
      channelsData.map((channel) => [channel.id, getDefaultChannelConfig(channel)]),
    );
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

function addEnvRow() {
  extraEnv = [...extraEnv, { name: "", value: "" }];
}

function removeEnvRow(index: number) {
  extraEnv = extraEnv.filter((_, idx) => idx !== index);
}

function updateEnvName(index: number, value: string) {
  extraEnv = extraEnv.map((item, idx) =>
    idx === index ? { ...item, name: value } : item,
  );
}

function updateEnvValue(index: number, value: string) {
  extraEnv = extraEnv.map((item, idx) =>
    idx === index ? { ...item, value } : item,
  );
}

function updateDiscordConfig(channelId: string, updater: (config: RuntimeChannelConfigInput) => RuntimeChannelConfigInput) {
  channelConfigById = {
    ...channelConfigById,
    [channelId]: updater(channelConfigById[channelId] ?? {}),
  };
}

async function handleSubmit(event: SubmitEvent) {
  event.preventDefault();
  if (!workspace || isSubmitting) return;

  submitError = "";
  isSubmitting = true;

  try {
    const channelBindings: RuntimeChannelBindingInput[] = selectedChannelIds.map((channelId) => ({
      channelId,
      config: channelConfigById[channelId] ?? null,
    }));
    const normalizedExtraEnv: RuntimeEnvInput[] = extraEnv
      .map((item) => ({
        name: item.name.trim(),
        value: item.value,
      }))
      .filter((item) => item.name.length > 0);

    const result = await createRuntime({
      workspaceId: workspace.id,
      title: title.trim() || workspace.name,
      source: "web",
      start: startNow,
      extraEnv: normalizedExtraEnv,
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
          <div class="text-xs uppercase tracking-[0.2em] font-black text-brand">Environment variables</div>
          <h2 class="mt-2 text-xl font-semibold text-gray-900">Extra env for runtime startup</h2>
          <p class="mt-1 text-sm text-gray-500">These env vars will be injected when the runtime pod starts. Reserved system env names are not allowed.</p>
        </div>

        {#if extraEnv.length === 0}
          <div class="rounded-xl border border-dashed border-gray-200 p-4 text-sm text-gray-500">
            No extra env configured yet.
          </div>
        {:else}
          <div class="space-y-3">
            {#each extraEnv as envItem, index}
              <div class="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-start">
                <input
                  type="text"
                  value={envItem.name}
                  placeholder="ENV_NAME"
                  oninput={(event) => updateEnvName(index, (event.currentTarget as HTMLInputElement).value)}
                  class="w-full px-4 py-2 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-brand focus:border-brand outline-none font-mono text-sm"
                />
                <input
                  type="text"
                  value={envItem.value}
                  placeholder="value"
                  oninput={(event) => updateEnvValue(index, (event.currentTarget as HTMLInputElement).value)}
                  class="w-full px-4 py-2 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-brand focus:border-brand outline-none font-mono text-sm"
                />
                <button
                  type="button"
                  onclick={() => removeEnvRow(index)}
                  class="px-4 py-2 border border-gray-200 text-sm font-medium rounded-xl hover:bg-gray-50 transition-colors"
                >
                  Remove
                </button>
              </div>
            {/each}
          </div>
        {/if}

        <div>
          <button
            type="button"
            onclick={addEnvRow}
            class="px-4 py-2 border border-gray-200 text-sm font-medium rounded-xl hover:bg-gray-50 transition-colors"
          >
            Add env
          </button>
        </div>
      </div>

      <div class="bg-white border border-gray-200 rounded-2xl shadow-sm p-6 space-y-4">
        <div>
          <div class="text-xs uppercase tracking-[0.2em] font-black text-brand">Channel bindings</div>
          <h2 class="mt-2 text-xl font-semibold text-gray-900">Bind channels to this runtime</h2>
          <p class="mt-1 text-sm text-gray-500">You can leave this empty, or select multiple channels to connect now.</p>
        </div>

        {#if channels.length === 0}
          <div class="rounded-xl border border-dashed border-gray-200 p-4 text-sm text-gray-500">
            No channels available yet.
          </div>
        {:else}
          <div class="space-y-3">
            {#each channels as channel}
              <div class="rounded-xl border border-gray-200 px-4 py-3">
                <label class="flex items-center gap-3 text-sm text-gray-700 hover:bg-gray-50 transition-colors cursor-pointer rounded-lg">
                  <input
                    type="checkbox"
                    checked={selectedChannelIds.includes(channel.id)}
                    onchange={(event) => toggleChannel(channel.id, (event.currentTarget as HTMLInputElement).checked)}
                    class="rounded border-gray-300 text-brand focus:ring-brand"
                  />
                  <div class="min-w-0 flex-1">
                    <div class="font-medium text-gray-900">{channel.name || channel.provider}</div>
                    <div class="text-xs text-gray-500 uppercase tracking-wide">{channel.provider}</div>
                  </div>
                </label>

                {#if selectedChannelIds.includes(channel.id) && channel.provider === "discord"}
                  <div class="mt-4 ml-7 space-y-4 rounded-xl bg-gray-50 border border-gray-200 p-4">
                    <div>
                      <div class="text-xs uppercase tracking-[0.18em] font-semibold text-gray-500">Inbound</div>
                      <label class="mt-2 flex items-center gap-3 text-sm text-gray-700">
                        <input
                          type="checkbox"
                          checked={channelConfigById[channel.id]?.inbound?.requireMentionInGuild !== false}
                          onchange={(event) => updateDiscordConfig(channel.id, (config) => ({
                            ...config,
                            inbound: {
                              ...(config.inbound ?? {}),
                              requireMentionInGuild: (event.currentTarget as HTMLInputElement).checked,
                            },
                          }))}
                          class="rounded border-gray-300 text-brand focus:ring-brand"
                        />
                        Require mention in non-DM messages
                      </label>
                    </div>

                    <div>
                      <div class="text-xs uppercase tracking-[0.18em] font-semibold text-gray-500">Outbound</div>
                      <div class="mt-2 space-y-2">
                        <label class="flex items-center gap-3 text-sm text-gray-700">
                          <input
                            type="checkbox"
                            checked={channelConfigById[channel.id]?.outbound?.showThinking === true}
                            onchange={(event) => updateDiscordConfig(channel.id, (config) => ({
                              ...config,
                              outbound: {
                                ...(config.outbound ?? {}),
                                showThinking: (event.currentTarget as HTMLInputElement).checked,
                              },
                            }))}
                            class="rounded border-gray-300 text-brand focus:ring-brand"
                          />
                          Show thinking
                        </label>
                        <label class="flex items-center gap-3 text-sm text-gray-700">
                          <input
                            type="checkbox"
                            checked={channelConfigById[channel.id]?.outbound?.showToolCalls === true}
                            onchange={(event) => updateDiscordConfig(channel.id, (config) => ({
                              ...config,
                              outbound: {
                                ...(config.outbound ?? {}),
                                showToolCalls: (event.currentTarget as HTMLInputElement).checked,
                              },
                            }))}
                            class="rounded border-gray-300 text-brand focus:ring-brand"
                          />
                          Show tool calls
                        </label>
                      </div>
                    </div>
                  </div>
                {/if}
              </div>
            {/each}
          </div>
        {/if}
      </div>

      {#if submitError}
        <div class="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {submitError}
        </div>
      {/if}

      <div class="flex items-center justify-end gap-3">
        <button
          type="button"
          onclick={() => goto(`/workspaces/${params.id}`)}
          class="px-4 py-2 border border-gray-200 text-sm font-medium rounded-xl hover:bg-gray-50 transition-colors"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={isSubmitting}
          class="px-4 py-2 bg-brand text-white text-sm font-medium rounded-xl hover:bg-brand/90 transition-colors disabled:opacity-50"
        >
          {isSubmitting ? "Creating runtime..." : "Create Runtime"}
        </button>
      </div>
    </form>
  {/if}
</div>
