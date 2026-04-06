<script lang="ts">
import { page } from "$app/state";
import { goto } from "$app/navigation";
import { onMount } from "svelte";
import { FolderKanban, ArrowLeft, Plus, Loader2 } from "lucide-svelte";
import {
  getWorkspaces,
  getChannels,
  createRuntime,
  type WorkspaceListItem,
  type Channel,
  type RuntimeChannelBindingInput,
  type RuntimeChannelConfigInput,
  type RuntimeEnvInput,
} from "$lib/api";
import { ensureAuth } from "$lib/auth";

let workspaces = $state<WorkspaceListItem[]>([]);
let channels = $state<Channel[]>([]);
let isLoading = $state(true);
let isSubmitting = $state(false);
let loadError = $state("");
let submitError = $state("");

let selectedWorkspaceId = $state(page.url.searchParams.get("workspaceId") ?? "");
let title = $state("");
let startNow = $state(true);
let selectedChannelIds = $state<string[]>([]);
let extraEnv = $state<RuntimeEnvInput[]>([]);
let channelConfigById = $state<Record<string, RuntimeChannelConfigInput>>({});

const selectedWorkspace = $derived(workspaces.find((w) => w.id === selectedWorkspaceId) ?? null);

const getDefaultChannelConfig = (channel: Channel): RuntimeChannelConfigInput => {
  if (channel.provider === "discord") {
    return {
      inbound: { requireMentionInGuild: false },
      outbound: { showThinking: true, showToolCalls: true },
    };
  }
  return {};
};

async function loadPage() {
  if (!(await ensureAuth())) return;
  isLoading = true;
  loadError = "";

  try {
    const [wsList, channelsData] = await Promise.all([
      getWorkspaces(),
      getChannels(),
    ]);

    workspaces = wsList;
    channels = channelsData;
    channelConfigById = Object.fromEntries(
      channelsData.map((ch) => [ch.id, getDefaultChannelConfig(ch)]),
    );
  } catch (error) {
    loadError = error instanceof Error ? error.message : "Failed to load form data";
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
  if (!selectedWorkspaceId || isSubmitting) return;

  submitError = "";
  isSubmitting = true;

  try {
    const channelBindings: RuntimeChannelBindingInput[] = selectedChannelIds.map((channelId) => ({
      channelId,
      config: channelConfigById[channelId] ?? null,
    }));
    const normalizedExtraEnv: RuntimeEnvInput[] = extraEnv
      .map((item) => ({ name: item.name.trim(), value: item.value }))
      .filter((item) => item.name.length > 0);

    const result = await createRuntime({
      workspaceId: selectedWorkspaceId,
      title: title.trim() || selectedWorkspace?.name,
      source: "web",
      start: startNow,
      extraEnv: normalizedExtraEnv,
      channelBindings,
    });

    await goto(`/runtimes/${result.runtime.id}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create runtime";
    if (message.includes("channel binding already exists") || message.includes("409")) {
      submitError = "This channel is already bound to another runtime.";
    } else {
      submitError = message;
    }
  } finally {
    isSubmitting = false;
  }
}
</script>

<div class="flex-1 flex flex-col min-h-0 overflow-y-auto">
  <!-- Header -->
  <div class="h-10 flex items-center px-4 border-b border-border-primary shrink-0 bg-bg-primary">
    <div class="flex items-center gap-3 min-w-0">
      <a href="/runtimes" class="text-text-tertiary hover:text-text-primary transition-colors shrink-0" onclick={(e) => { e.preventDefault(); goto("/runtimes"); }}>
        <ArrowLeft class="w-4 h-4" />
      </a>
      <div class="w-[1px] h-4 bg-border-primary shrink-0"></div>
      <span class="text-xs font-medium text-text-secondary">New Runtime</span>
    </div>
  </div>

  <div class="flex-1 p-4 overflow-y-auto max-w-2xl">
    {#if isLoading}
      <div class="flex items-center justify-center py-12 text-xs text-text-tertiary">
        <Loader2 class="w-4 h-4 animate-spin mr-2" />
        Loading form...
      </div>
    {:else if loadError}
      <div class="rounded-md border border-rose-500/20 bg-rose-500/10 p-3 text-xs font-mono text-rose-400 break-all">{loadError}</div>
    {:else}
      <form onsubmit={handleSubmit} class="space-y-4">
        <!-- Workspace Selection -->
        <div class="border border-border-primary rounded-lg bg-bg-surface p-4 space-y-3">
          <div>
            <div class="text-[10px] uppercase tracking-wider text-text-tertiary font-medium">Workspace</div>
            <p class="text-xs text-text-tertiary mt-1">Choose the workspace to create a runtime from.</p>
          </div>

          {#if workspaces.length === 0}
            <div class="text-xs text-text-placeholder py-2">No workspaces available</div>
          {:else}
            <div class="space-y-1.5 max-h-48 overflow-y-auto">
              {#each workspaces as ws (ws.id)}
                <label
                  class="flex items-center gap-3 p-2.5 rounded-md border transition-colors cursor-pointer {
                    selectedWorkspaceId === ws.id
                      ? 'border-border-primary bg-hover-strong'
                      : 'border-border-subtle bg-bg-code hover:border-border-primary/20 hover:bg-bg-surface-hover'
                  }"
                >
                  <input
                    type="radio"
                    name="workspace"
                    checked={selectedWorkspaceId === ws.id}
                    onchange={() => selectedWorkspaceId = ws.id}
                    class="rounded-sm bg-bg-input border-border-primary checked:bg-emerald-500 shrink-0"
                  />
                  <div class="w-7 h-7 rounded-md bg-blue-500/10 border border-blue-500/20 flex items-center justify-center shrink-0">
                    <FolderKanban class="w-3.5 h-3.5 text-blue-400/70" />
                  </div>
                  <div class="min-w-0 flex-1">
                    <div class="text-sm font-medium text-text-primary truncate">{ws.name}</div>
                    <div class="text-[10px] text-text-placeholder font-mono truncate">{ws.giteaRepoName}</div>
                  </div>
                </label>
              {/each}
            </div>
          {/if}
        </div>

        <!-- Basic Info (only shown after workspace selection) -->
        {#if selectedWorkspaceId}
          <div class="border border-border-primary rounded-lg bg-bg-surface p-4 space-y-3">
            <div>
              <div class="text-[10px] uppercase tracking-wider text-text-tertiary font-medium">Runtime</div>
              <h2 class="mt-1 text-sm font-medium text-text-primary">{selectedWorkspace?.name}</h2>
            </div>

            <div>
              <label class="block text-[10px] font-medium uppercase tracking-wider text-text-tertiary mb-1.5" for="rt-title">Title</label>
              <input
                id="rt-title"
                bind:value={title}
                type="text"
                placeholder="Runtime title (defaults to workspace name)"
                class="w-full px-3 py-1.5 rounded-md bg-bg-input border border-border-primary text-xs text-text-primary placeholder:text-text-placeholder focus:border-border-primary/30 focus:outline-none font-mono"
              />
            </div>

            <label class="flex items-center gap-2 cursor-pointer">
              <input bind:checked={startNow} type="checkbox" class="rounded-sm bg-bg-input border-border-primary checked:bg-emerald-500" />
              <span class="text-xs text-text-secondary">Start runtime immediately</span>
            </label>
          </div>

          <!-- Env Vars -->
          <div class="border border-border-primary rounded-lg bg-bg-surface p-4 space-y-3">
            <div>
              <div class="text-[10px] uppercase tracking-wider text-text-tertiary font-medium">Environment Variables</div>
              <p class="text-xs text-text-tertiary mt-1">Extra env vars injected at runtime startup.</p>
            </div>

            {#if extraEnv.length === 0}
              <div class="text-xs text-text-placeholder py-2">No extra env configured</div>
            {:else}
              <div class="space-y-2">
                {#each extraEnv as envItem, index}
                  <div class="flex gap-2">
                    <input
                      type="text"
                      value={envItem.name}
                      placeholder="ENV_NAME"
                      oninput={(event) => updateEnvName(index, (event.currentTarget as HTMLInputElement).value)}
                      class="flex-1 px-3 py-1.5 rounded-md bg-bg-input border border-border-primary text-xs text-text-primary placeholder:text-text-placeholder focus:border-border-primary/30 focus:outline-none font-mono"
                    />
                    <input
                      type="text"
                      value={envItem.value}
                      placeholder="value"
                      oninput={(event) => updateEnvValue(index, (event.currentTarget as HTMLInputElement).value)}
                      class="flex-1 px-3 py-1.5 rounded-md bg-bg-input border border-border-primary text-xs text-text-primary placeholder:text-text-placeholder focus:border-border-primary/30 focus:outline-none font-mono"
                    />
                    <button
                      type="button"
                      onclick={() => removeEnvRow(index)}
                      class="px-2 py-1.5 rounded-md bg-hover hover:bg-hover-strong border border-border-primary text-xs text-text-tertiary hover:text-text-secondary transition-colors cursor-pointer"
                    >
                      ✕
                    </button>
                  </div>
                {/each}
              </div>
            {/if}

            <button
              type="button"
              onclick={addEnvRow}
              class="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-hover hover:bg-hover-strong border border-border-primary text-xs text-text-tertiary hover:text-text-secondary transition-colors cursor-pointer"
            >
              <Plus class="w-3.5 h-3.5" />
              Add env
            </button>
          </div>

          <!-- Channel Bindings -->
          <div class="border border-border-primary rounded-lg bg-bg-surface p-4 space-y-3">
            <div>
              <div class="text-[10px] uppercase tracking-wider text-text-tertiary font-medium">Channel Bindings</div>
              <p class="text-xs text-text-tertiary mt-1">Connect channels to this runtime.</p>
            </div>

            {#if channels.length === 0}
              <div class="text-xs text-text-placeholder py-2">No channels available</div>
            {:else}
              <div class="space-y-2">
                {#each channels as channel (channel.id)}
                  <div class="rounded-md border border-border-subtle bg-bg-code p-3">
                    <label class="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedChannelIds.includes(channel.id)}
                        onchange={(event) => toggleChannel(channel.id, (event.currentTarget as HTMLInputElement).checked)}
                        class="rounded-sm bg-bg-input border-border-primary checked:bg-emerald-500"
                      />
                      <div class="min-w-0 flex-1">
                        <div class="text-xs text-text-secondary">{channel.name || channel.provider}</div>
                        <div class="text-[10px] uppercase tracking-wider text-text-tertiary">{channel.provider}</div>
                      </div>
                    </label>

                    {#if selectedChannelIds.includes(channel.id) && channel.provider === "discord"}
                      <div class="mt-3 ml-5 space-y-2 rounded-md bg-bg-code border border-border-subtle p-3">
                        <label class="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={channelConfigById[channel.id]?.inbound?.requireMentionInGuild !== false}
                            onchange={(event) => updateDiscordConfig(channel.id, (config) => ({
                              ...config,
                              inbound: { ...(config.inbound ?? {}), requireMentionInGuild: (event.currentTarget as HTMLInputElement).checked },
                            }))}
                            class="rounded-sm bg-bg-input border-border-primary checked:bg-emerald-500"
                          />
                          <span class="text-xs text-text-tertiary">Require mention in non-DM</span>
                        </label>
                        <label class="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={channelConfigById[channel.id]?.outbound?.showThinking === true}
                            onchange={(event) => updateDiscordConfig(channel.id, (config) => ({
                              ...config,
                              outbound: { ...(config.outbound ?? {}), showThinking: (event.currentTarget as HTMLInputElement).checked },
                            }))}
                            class="rounded-sm bg-bg-input border-border-primary checked:bg-emerald-500"
                          />
                          <span class="text-xs text-text-tertiary">Show thinking</span>
                        </label>
                        <label class="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={channelConfigById[channel.id]?.outbound?.showToolCalls === true}
                            onchange={(event) => updateDiscordConfig(channel.id, (config) => ({
                              ...config,
                              outbound: { ...(config.outbound ?? {}), showToolCalls: (event.currentTarget as HTMLInputElement).checked },
                            }))}
                            class="rounded-sm bg-bg-input border-border-primary checked:bg-emerald-500"
                          />
                          <span class="text-xs text-text-tertiary">Show tool calls</span>
                        </label>
                      </div>
                    {/if}
                  </div>
                {/each}
              </div>
            {/if}
          </div>

          <!-- Actions -->
          {#if submitError}
            <div class="rounded-md border border-rose-500/20 bg-rose-500/10 p-3 text-xs font-mono text-rose-400 break-all">{submitError}</div>
          {/if}

          <div class="flex items-center justify-end gap-2">
            <button
              type="button"
              onclick={() => goto("/runtimes")}
              class="px-4 py-1.5 rounded-md bg-hover hover:bg-hover-strong border border-border-primary text-xs text-text-tertiary hover:text-text-secondary transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !selectedWorkspaceId}
              class="px-4 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-500 text-xs text-white font-medium transition-colors disabled:opacity-50 cursor-pointer"
            >
              {#if isSubmitting}
                <Loader2 class="w-3.5 h-3.5 animate-spin inline mr-1.5" />
                Creating...
              {:else}
                Create Runtime
              {/if}
            </button>
          </div>
        {/if}
      </form>
    {/if}
  </div>
</div>
