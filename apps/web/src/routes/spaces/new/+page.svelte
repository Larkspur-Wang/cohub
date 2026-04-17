<script lang="ts">
import { goto } from "$app/navigation";
import { onMount } from "svelte";
import { ArrowLeft, Loader2, Plus, X } from "lucide-svelte";
import {
  getChannels,
  createSpace,
  type Channel,
  type SpaceChannelBindingInput,
  type ChannelConfig,
  type DiscordChannelConfig,
  type SpaceEnvInput,
} from "$lib/api";
import { ensureAuth } from "$lib/auth";

let channels = $state<Channel[]>([]);
let isLoading = $state(true);
let isSubmitting = $state(false);
let loadError = $state("");
let submitError = $state("");

let name = $state("");
let description = $state("");
let cwd = $state("");
let protocol = $state<"pi" | "acp" | "internal">("pi");
let selectedChannelIds = $state<string[]>([]);
let extraEnv = $state<SpaceEnvInput[]>([]);
let channelConfigById = $state<Record<string, ChannelConfig>>({});

const getDefaultChannelConfig = (channel: Channel): ChannelConfig => {
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
    const channelsData = await getChannels();
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
  void loadPage();
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
    idx === index ? { ...item, value: value } : item,
  );
}

function updateDiscordConfig(channelId: string, updater: (config: DiscordChannelConfig) => DiscordChannelConfig) {
  channelConfigById = {
    ...channelConfigById,
    [channelId]: updater((channelConfigById[channelId] ?? {}) as DiscordChannelConfig),
  };
}

async function handleSubmit(event: SubmitEvent) {
  event.preventDefault();
  if (!name.trim() || isSubmitting) return;

  submitError = "";
  isSubmitting = true;

  try {
    const channelBindings: SpaceChannelBindingInput[] = selectedChannelIds.map((channelId) => ({
      channelId,
      config: channelConfigById[channelId] ?? null,
    }));
    const normalizedExtraEnv: SpaceEnvInput[] = extraEnv
      .map((item) => ({ name: item.name.trim(), value: item.value }))
      .filter((item) => item.name.length > 0);

    const result = await createSpace({
      name: name.trim(),
      description: description.trim() || undefined,
      source: "web",
      cwd: cwd.trim() || undefined,
      protocol,
      extraEnv: normalizedExtraEnv,
      channelBindings,
    });

    window.dispatchEvent(new CustomEvent("cohub:space-created"));

    const sessionId = result.session?.id;
    const query = sessionId ? `?session=${sessionId}` : "";
    await goto(`/spaces/${result.space.id}${query}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create space";
    if (message.includes("channel binding already exists") || message.includes("409")) {
      submitError = "This channel is already bound to another space.";
    } else {
      submitError = message;
    }
  } finally {
    isSubmitting = false;
  }
}
</script>

<div class="flex-1 flex flex-col min-h-0 overflow-y-auto">
  <div class="h-[40px] flex items-center px-4 border-b border-border-subtle shrink-0 bg-bg-primary">
    <div class="flex items-center gap-3 min-w-0">
      <a href="/spaces" class="text-text-tertiary hover:text-text-primary transition-colors shrink-0" onclick={(e) => { e.preventDefault(); goto("/spaces"); }}>
        <ArrowLeft class="w-4 h-4" />
      </a>
      <div class="w-[1px] h-4 bg-border-subtle shrink-0"></div>
      <span class="text-[11px] font-medium text-text-secondary">New Space</span>
    </div>
  </div>

  <div class="flex-1 p-4 overflow-y-auto max-w-2xl">
    {#if isLoading}
      <div class="flex items-center justify-center py-12 text-[12px] text-text-tertiary">
        <Loader2 class="w-4 h-4 animate-spin mr-2" />
        Loading form...
      </div>
    {:else if loadError}
      <div class="rounded-md border border-error-soft/30 bg-error-bg p-3 text-[12px] font-mono text-error-soft break-all">{loadError}</div>
    {:else}
      <form onsubmit={handleSubmit} class="space-y-3">
        <div class="border border-border-subtle rounded-md bg-bg-surface p-4 space-y-3">
          <div>
            <div class="text-[10px] uppercase tracking-wider text-text-placeholder font-medium">Space</div>
            <p class="text-[13px] text-text-tertiary mt-1">Create a new space. A session will be prepared automatically.</p>
          </div>

          <div>
            <label class="block text-[10px] font-medium uppercase tracking-wider text-text-tertiary mb-1.5" for="space-name">Name</label>
            <input
              id="space-name"
              bind:value={name}
              type="text"
              placeholder="my-product-space"
              class="w-full px-3 py-[6px] rounded-[5px] bg-bg-input border border-border-subtle text-[13px] text-text-primary placeholder:text-text-placeholder focus:border-brand/40 focus:outline-none font-mono transition-colors"
              required
            />
          </div>

          <div>
            <label class="block text-[10px] font-medium uppercase tracking-wider text-text-tertiary mb-1.5" for="space-description">Description</label>
            <textarea
              id="space-description"
              bind:value={description}
              rows="3"
              placeholder="Optional description"
              class="w-full px-3 py-[8px] rounded-[5px] bg-bg-input border border-border-subtle text-[13px] text-text-primary placeholder:text-text-placeholder focus:border-brand/40 focus:outline-none transition-colors resize-y"
            ></textarea>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label class="block text-[10px] font-medium uppercase tracking-wider text-text-tertiary mb-1.5" for="space-protocol">Protocol</label>
              <select
                id="space-protocol"
                bind:value={protocol}
                class="w-full px-3 py-[6px] rounded-[5px] bg-bg-input border border-border-subtle text-[13px] text-text-primary focus:border-brand/40 focus:outline-none transition-colors"
              >
                <option value="pi">pi</option>
                <option value="acp">acp</option>
                <option value="internal">internal</option>
              </select>
            </div>

            <div>
              <label class="block text-[10px] font-medium uppercase tracking-wider text-text-tertiary mb-1.5" for="space-cwd">Working Directory</label>
              <input
                id="space-cwd"
                bind:value={cwd}
                type="text"
                placeholder="/workspace"
                class="w-full px-3 py-[6px] rounded-[5px] bg-bg-input border border-border-subtle text-[13px] text-text-primary placeholder:text-text-placeholder focus:border-brand/40 focus:outline-none font-mono transition-colors"
              />
            </div>
          </div>
        </div>

        <div class="border border-border-subtle rounded-md bg-bg-surface p-4 space-y-3">
          <div>
            <div class="text-[10px] uppercase tracking-wider text-text-placeholder font-medium">Environment Variables</div>
            <p class="text-[13px] text-text-tertiary mt-1">Optional env vars injected into the space environment.</p>
          </div>

          {#if extraEnv.length === 0}
            <div class="text-[13px] text-text-placeholder py-1">No extra env configured</div>
          {:else}
            <div class="space-y-2">
              {#each extraEnv as envItem, index}
                <div class="flex flex-col sm:flex-row gap-2">
                  <input
                    type="text"
                    value={envItem.name}
                    placeholder="ENV_NAME"
                    oninput={(event) => updateEnvName(index, (event.currentTarget as HTMLInputElement).value)}
                    class="flex-1 px-3 py-[6px] rounded-[5px] bg-bg-input border border-border-subtle text-[13px] text-text-primary placeholder:text-text-placeholder focus:border-brand/40 focus:outline-none font-mono transition-colors"
                  />
                  <input
                    type="text"
                    value={envItem.value}
                    placeholder="value"
                    oninput={(event) => updateEnvValue(index, (event.currentTarget as HTMLInputElement).value)}
                    class="flex-1 px-3 py-[6px] rounded-[5px] bg-bg-input border border-border-subtle text-[13px] text-text-primary placeholder:text-text-placeholder focus:border-brand/40 focus:outline-none font-mono transition-colors"
                  />
                  <button type="button" class="w-full sm:w-auto px-3 py-[6px] rounded-[5px] bg-bg-input border border-border-subtle text-[12px] text-text-tertiary hover:text-error-soft hover:border-error-soft/20 transition-colors" onclick={() => removeEnvRow(index)}>
                    Remove
                  </button>
                </div>
              {/each}
            </div>
          {/if}

          <button type="button" class="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-[5px] bg-bg-input border border-border-subtle text-[12px] text-text-secondary hover:text-text-primary transition-colors" onclick={addEnvRow}>
            <Plus class="w-3.5 h-3.5" />
            Add env var
          </button>
        </div>

        <div class="border border-border-subtle rounded-md bg-bg-surface p-4 space-y-3">
          <div>
            <div class="text-[10px] uppercase tracking-wider text-text-placeholder font-medium">Channels</div>
            <p class="text-[13px] text-text-tertiary mt-1">Optional channels to bind to this space.</p>
          </div>

          {#if channels.length === 0}
            <div class="text-[13px] text-text-placeholder py-1">No channels available</div>
          {:else}
            <div class="space-y-2">
              {#each channels as channel (channel.id)}
                <label class="block rounded-[6px] border border-border-subtle bg-bg-code p-3 transition-colors hover:border-border-primary">
                  <div class="flex items-start gap-3">
                    <input
                      type="checkbox"
                      checked={selectedChannelIds.includes(channel.id)}
                      onchange={(event) => toggleChannel(channel.id, (event.currentTarget as HTMLInputElement).checked)}
                      class="mt-0.5 rounded-sm bg-bg-input border-border-subtle checked:bg-brand shrink-0"
                    />
                    <div class="min-w-0 flex-1">
                      <div class="flex items-center gap-2 min-w-0">
                        <span class="text-[13px] font-medium text-text-primary truncate">{channel.name}</span>
                        <span class="text-[10px] uppercase tracking-wider text-text-tertiary shrink-0">{channel.provider}</span>
                      </div>

                      {#if selectedChannelIds.includes(channel.id) && channel.provider === "discord"}
                        {@const config = (channelConfigById[channel.id] ?? {}) as DiscordChannelConfig}
                        <div class="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3 border-t border-border-subtle pt-3">
                          <label class="flex items-center gap-2 text-[12px] text-text-secondary">
                            <input
                              type="checkbox"
                              checked={config.inbound?.requireMentionInGuild ?? false}
                              onchange={(event) => updateDiscordConfig(channel.id, (current) => ({
                                ...current,
                                inbound: {
                                  ...(current.inbound ?? {}),
                                  requireMentionInGuild: (event.currentTarget as HTMLInputElement).checked,
                                },
                              }))}
                              class="rounded-sm bg-bg-input border-border-subtle checked:bg-brand"
                            />
                            Require mention in guild
                          </label>
                          <label class="flex items-center gap-2 text-[12px] text-text-secondary">
                            <input
                              type="checkbox"
                              checked={config.outbound?.showThinking ?? true}
                              onchange={(event) => updateDiscordConfig(channel.id, (current) => ({
                                ...current,
                                outbound: {
                                  ...(current.outbound ?? {}),
                                  showThinking: (event.currentTarget as HTMLInputElement).checked,
                                },
                              }))}
                              class="rounded-sm bg-bg-input border-border-subtle checked:bg-brand"
                            />
                            Show thinking
                          </label>
                        </div>
                      {/if}
                    </div>
                  </div>
                </label>
              {/each}
            </div>
          {/if}
        </div>

        {#if submitError}
          <div class="rounded-md border border-error-soft/30 bg-error-bg p-3 text-[12px] font-mono text-error-soft break-all">{submitError}</div>
        {/if}

        <div class="flex items-center justify-end gap-2 pt-1">
          <button type="button" class="px-3 py-1.5 rounded-[5px] border border-border-subtle text-[13px] text-text-secondary hover:text-text-primary transition-colors" onclick={() => goto("/spaces")}>Cancel</button>
          <button
            type="submit"
            class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[5px] bg-[#FF3E00]/10 border border-[#FF3E00]/20 text-[13px] text-brand font-medium hover:bg-[#FF3E00]/15 transition-colors disabled:opacity-60"
            disabled={isSubmitting || !name.trim()}
          >
            {#if isSubmitting}
              <Loader2 class="w-3.5 h-3.5 animate-spin" />
              Creating...
            {:else}
              Create Space
            {/if}
          </button>
        </div>
      </form>
    {/if}
  </div>
</div>
