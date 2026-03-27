<script lang="ts">
import { onMount } from "svelte";
import {
  forkSession,
  getRuntime,
  getRuntimeChannels,
  getRuntimeProvisioning,
  getRuntimeSessions,
  getRuntimeStreamUrl,
  getSessionMessages,
  updateRuntimeChannelConfig,
  type RuntimeChannelConfigInput,
  type RuntimeChannelRecord,
  type RuntimeProvisionResponse,
  type RuntimeRecord,
  type SessionRecord,
  type SessionMessageRecord,
  type SessionToolCallRecord,
} from "$lib/api";
import ChatTimeline from "$lib/components/ChatTimeline.svelte";
import SessionComposer from "$lib/components/SessionComposer.svelte";
import {
  toChatMessages,
  type TimelineItem,
} from "$lib/session-tree";

type PersistedData = {
  runtime: RuntimeRecord;
  session: SessionRecord;
  messages: SessionMessageRecord[];
  toolCalls: SessionToolCallRecord[];
};

type Props = {
  data: {
    runtime: RuntimeRecord;
    session: SessionRecord | null;
    persisted: PersistedData | null;
  };
};

type SessionViewState = {
  session: SessionRecord;
  messages: SessionMessageRecord[];
  toolCalls: SessionToolCallRecord[];
  loading: boolean;
  error: string;
};

const { data }: Props = $props();

let runtime = $state<RuntimeRecord>({} as RuntimeRecord);
let runtimeSessions = $state<SessionRecord[]>([]);
let runtimeChannels = $state<RuntimeChannelRecord[]>([]);
let sessionStateById = $state<Record<string, SessionViewState>>({});
let activeSessionId = $state<string | null>(null);
let input = $state("");
let sending = $state(false);
let runtimeLoadError = $state("");
let streamStatus = $state<"connecting" | "open" | "closed" | "error">("connecting");
let streamError = $state("");
let provisioning = $state<RuntimeProvisionResponse | null>(null);
let provisioningError = $state("");
let streamingAssistantText = $state("");
let eventSource: EventSource | null = null;
let provisioningPollingTimer: ReturnType<typeof setInterval> | null = null;
let listEl = $state<HTMLDivElement | null>(null);
let initializedFromData = $state(false);
let savingChannelConfigById = $state<Record<string, boolean>>({});
let channelConfigErrorById = $state<Record<string, string>>({});

$effect(() => {
  if (initializedFromData) return;

  runtime = data.runtime;
  activeSessionId = data.session?.id ?? null;
  sessionStateById =
    data.session && data.persisted
      ? {
          [data.session.id]: {
            session: data.session,
            messages: data.persisted.messages,
            toolCalls: data.persisted.toolCalls,
            loading: false,
            error: "",
          },
        }
      : {};
  initializedFromData = true;
});

const activeSessionState = $derived(activeSessionId ? sessionStateById[activeSessionId] ?? null : null);
const timeline = $derived.by<TimelineItem[]>(() => {
  const state = activeSessionState;
  if (!state) return [];
  const items = toChatMessages(state.messages, state.toolCalls).map((message) => ({
    id: message.id,
    kind: "message" as const,
    message,
  }));

  if (streamingAssistantText.trim()) {
    items.push({
      id: "assistant-streaming",
      kind: "message",
      message: {
        id: "assistant-streaming",
        role: "assistant",
        text: streamingAssistantText,
      },
    });
  }

  return items;
});

function getSessionTitle(session: SessionRecord, index: number) {
  return session.title?.trim() || session.latestMessageText?.trim() || `Session ${index + 1}`;
}

function getAllBindingDisplayLabels(session: SessionRecord) {
  const bindings = session.bindings ?? [];
  const seen = new Set<string>();
  const labels: string[] = [];

  for (const binding of bindings) {
    const meta = (binding.meta ?? {}) as Record<string, unknown>;
    const conversation = (meta.conversation ?? null) as Record<string, unknown> | null;
    const providerMeta = (meta.providerMeta ?? null) as Record<string, unknown> | null;

    if (binding.provider === "web") continue;

    let label: string | null = null;
    if (binding.provider === "discord") {
      const conversationMeta = (conversation?.meta as Record<string, unknown> | null) ?? null;
      const isDm = conversationMeta?.isDm === true || providerMeta?.isDm === true;
      const isThread = conversationMeta?.isThread === true || providerMeta?.isThread === true;
      const threadName = typeof providerMeta?.threadName === "string"
        ? providerMeta.threadName
        : typeof conversationMeta?.threadName === "string"
          ? conversationMeta.threadName
          : null;
      const channelName = typeof providerMeta?.channelName === "string"
        ? providerMeta.channelName
        : typeof providerMeta?.parentChannelName === "string"
          ? providerMeta.parentChannelName
          : typeof conversationMeta?.channelName === "string"
            ? conversationMeta.channelName
            : null;

      if (isDm) label = "Discord DM";
      else if (isThread) label = threadName ? `Discord thread · ${threadName}` : "Discord thread";
      else if (channelName) label = `Discord channel · #${channelName}`;
      else label = "Discord channel";
    } else {
      const conversationName = typeof providerMeta?.conversationName === "string"
        ? providerMeta.conversationName
        : typeof conversation?.name === "string"
          ? conversation.name
          : null;
      label = conversationName ? `${binding.provider} · ${conversationName}` : binding.provider;
    }

    if (label && !seen.has(label)) {
      seen.add(label);
      labels.push(label);
    }
  }

  return labels;
}

function getPrimaryBinding(session: SessionRecord) {
  return session.bindings?.[0] ?? null;
}

function getBindingDisplayLabel(session: SessionRecord) {
  const binding = getPrimaryBinding(session);
  if (!binding) return null;

  const meta = (binding.meta ?? {}) as Record<string, unknown>;
  const conversation = (meta.conversation ?? null) as Record<string, unknown> | null;
  const providerMeta = (meta.providerMeta ?? null) as Record<string, unknown> | null;

  if (binding.provider === "web") return null;

  if (binding.provider === "discord") {
    const isDm = conversation?.meta && typeof conversation.meta === "object"
      ? (conversation.meta as Record<string, unknown>).isDm === true
      : providerMeta?.isDm === true;
    const isThread = conversation?.meta && typeof conversation.meta === "object"
      ? (conversation.meta as Record<string, unknown>).isThread === true
      : providerMeta?.isThread === true;

    const threadName = typeof providerMeta?.threadName === "string"
      ? providerMeta.threadName
      : typeof (conversation?.meta as Record<string, unknown> | null)?.threadName === "string"
        ? (conversation?.meta as Record<string, unknown>).threadName as string
        : null;

    const channelName = typeof providerMeta?.channelName === "string"
      ? providerMeta.channelName
      : typeof providerMeta?.parentChannelName === "string"
        ? providerMeta.parentChannelName
        : null;

    if (isDm) return "Discord DM";
    if (isThread) return threadName ? `Discord thread · ${threadName}` : "Discord thread";
    if (channelName) return `Discord channel · #${channelName}`;
    return "Discord channel";
  }

  const conversationName = typeof providerMeta?.conversationName === "string"
    ? providerMeta.conversationName
    : typeof conversation?.name === "string"
      ? conversation.name
      : null;

  return conversationName ? `${binding.provider} · ${conversationName}` : binding.provider;
}

function getSessionSubLabel(session: SessionRecord) {
  const binding = getPrimaryBinding(session);
  if (!binding) return null;

  const providerMeta = ((binding.meta ?? {}) as Record<string, unknown>).providerMeta as Record<string, unknown> | null;

  if (binding.provider === "discord") {
    const channelName = typeof providerMeta?.channelName === "string" ? providerMeta.channelName : null;
    const guildName = typeof providerMeta?.guildName === "string" ? providerMeta.guildName : null;
    if (channelName && guildName) return `#${channelName} · ${guildName}`;
    if (guildName) return guildName;
  }

  return null;
}

function getDiscordRuntimeChannelConfig(runtimeChannel: RuntimeChannelRecord): RuntimeChannelConfigInput {
  return runtimeChannel.config ?? {
    inbound: {
      requireMentionInGuild: true,
    },
    outbound: {
      showThinking: false,
      showToolCalls: false,
      defaultDisplayMode: "minimal",
    },
  };
}

async function saveRuntimeChannelConfig(runtimeChannelId: string, config: RuntimeChannelConfigInput) {
  savingChannelConfigById = { ...savingChannelConfigById, [runtimeChannelId]: true };
  channelConfigErrorById = { ...channelConfigErrorById, [runtimeChannelId]: "" };

  try {
    const updated = await updateRuntimeChannelConfig(runtimeChannelId, { config });
    runtimeChannels = runtimeChannels.map((item) => (item.id === runtimeChannelId ? updated : item));
  } catch (error) {
    channelConfigErrorById = {
      ...channelConfigErrorById,
      [runtimeChannelId]: error instanceof Error ? error.message : "Failed to update channel config",
    };
  } finally {
    savingChannelConfigById = { ...savingChannelConfigById, [runtimeChannelId]: false };
  }
}

function patchDiscordRuntimeChannelConfig(
  runtimeChannel: RuntimeChannelRecord,
  updater: (config: RuntimeChannelConfigInput) => RuntimeChannelConfigInput,
) {
  const nextConfig = updater(getDiscordRuntimeChannelConfig(runtimeChannel));
  runtimeChannels = runtimeChannels.map((item) =>
    item.id === runtimeChannel.id ? { ...item, config: nextConfig } : item,
  );
  void saveRuntimeChannelConfig(runtimeChannel.id, nextConfig);
}

async function loadRuntime() {
  try {
    runtime = await getRuntime(runtime.id);
    const [sessionsResponse, runtimeChannelRows] = await Promise.all([
      getRuntimeSessions(runtime.id),
      getRuntimeChannels(runtime.id),
    ]);
    runtimeSessions = sessionsResponse.sessions;
    runtimeChannels = runtimeChannelRows;

    if (!activeSessionId && runtimeSessions.length > 0) {
      activeSessionId = runtimeSessions.at(-1)?.id ?? null;
    }
  } catch (error) {
    runtimeLoadError = error instanceof Error ? error.message : "Failed to load runtime";
  }
}

async function loadSessionState(sessionId: string, force = false) {
  const existing = sessionStateById[sessionId];
  if (existing && !force) return;

  const fallbackSession = runtimeSessions.find((item) => item.id === sessionId);
  if (!fallbackSession) return;

  sessionStateById = {
    ...sessionStateById,
    [sessionId]: {
      session: existing?.session ?? fallbackSession,
      messages: existing?.messages ?? [],
      toolCalls: existing?.toolCalls ?? [],
      loading: true,
      error: "",
    },
  };

  try {
    const response = await getSessionMessages(sessionId);
    sessionStateById = {
      ...sessionStateById,
      [sessionId]: {
        session: response.session,
        messages: response.messages,
        toolCalls: response.toolCalls,
        loading: false,
        error: "",
      },
    };
  } catch (error) {
    sessionStateById = {
      ...sessionStateById,
      [sessionId]: {
        session: existing?.session ?? fallbackSession,
        messages: existing?.messages ?? [],
        toolCalls: existing?.toolCalls ?? [],
        loading: false,
        error: error instanceof Error ? error.message : "Failed to load session",
      },
    };
  }
}

async function loadProvisioning() {
  try {
    provisioning = await getRuntimeProvisioning(runtime.id);
    provisioningError = "";
  } catch (error) {
    provisioningError = error instanceof Error ? error.message : "Failed to load provisioning";
  }
}

function connectStream() {
  eventSource?.close();
  streamStatus = "connecting";
  streamError = "";
  streamingAssistantText = "";

  const url = getRuntimeStreamUrl(runtime.id);
  eventSource = new EventSource(url, { withCredentials: true });

  eventSource.onopen = () => {
    streamStatus = "open";
  };

  eventSource.onerror = () => {
    streamStatus = "error";
    streamError = "Stream disconnected";
  };

  eventSource.onmessage = async (event) => {
    try {
      const payload = JSON.parse(event.data);
      if (payload.type === "agent_event") {
        const agentEvent = payload.event as Record<string, unknown>;
        if (agentEvent.type === "assistant_delta") {
          const text = typeof agentEvent.text === "string" ? agentEvent.text : "";
          streamingAssistantText = `${streamingAssistantText}${text}`;
          return;
        }
        if (agentEvent.type === "turn_end") {
          streamingAssistantText = "";
          if (activeSessionId) {
            await loadSessionState(activeSessionId, true);
          }
          await loadRuntime();
          return;
        }
      }
    } catch {
      // ignore malformed stream events
    }
  };
}

async function handleSend() {
  if (!activeSessionState || !input.trim() || sending) return;
  sending = true;

  try {
    const { sendSessionMessage } = await import("$lib/api");
    await sendSessionMessage(activeSessionState.session.id, { text: input.trim() });
    input = "";
    streamingAssistantText = "";
    await loadSessionState(activeSessionState.session.id, true);
  } finally {
    sending = false;
  }
}

async function handleFork(messageId: string) {
  if (!activeSessionState) return;
  const result = await forkSession(activeSessionState.session.id, { fromMessageId: messageId });
  runtimeSessions = [...runtimeSessions, result.session];
  activeSessionId = result.session.id;
  await loadSessionState(result.session.id, true);
}

onMount(() => {
  void loadRuntime();
  void loadProvisioning();
  connectStream();

  provisioningPollingTimer = setInterval(() => {
    void loadProvisioning();
  }, 5000);

  return () => {
    eventSource?.close();
    if (provisioningPollingTimer) clearInterval(provisioningPollingTimer);
  };
});

$effect(() => {
  if (activeSessionId) {
    void loadSessionState(activeSessionId);
  }
});

$effect(() => {
  if (listEl) {
    queueMicrotask(() => {
      listEl?.scrollTo({ top: listEl.scrollHeight, behavior: "smooth" });
    });
  }
});
</script>

<div class="grid h-[calc(100vh-7rem)] grid-cols-[260px_minmax(0,1fr)] overflow-hidden rounded-2xl border border-gray-200 bg-white">
  <aside class="border-r border-gray-200 bg-gray-50 p-4 overflow-y-auto">
    <div class="mb-4">
      <h1 class="text-lg font-semibold text-gray-900">{runtime.title || "Untitled Runtime"}</h1>
      <div class="mt-1 text-xs text-gray-500 break-all">{runtime.id}</div>
      <div class="mt-2 text-xs text-gray-500">status: {runtime.liveStatus ?? runtime.status ?? "unknown"}</div>
      {#if provisioning}
        <div class="mt-2 text-xs text-gray-500">provision: {provisioning.status} · {provisioning.currentStep}</div>
      {/if}
      {#if provisioningError}
        <div class="mt-2 text-xs text-red-600 break-all">{provisioningError}</div>
      {/if}
      {#if runtimeLoadError}
        <div class="mt-2 text-xs text-red-600 break-all">{runtimeLoadError}</div>
      {/if}
    </div>

    <div class="mb-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-gray-500">Sessions</div>
    <div class="space-y-2">
      {#if runtimeSessions.length === 0}
        <div class="rounded-lg border border-dashed border-gray-200 bg-white p-3 text-sm text-gray-500">No sessions yet.</div>
      {:else}
        {#each runtimeSessions as session, index (session.id)}
          <button
            class={`w-full rounded-lg border p-3 text-left text-sm transition ${activeSessionId === session.id ? 'border-brand bg-brand/5' : 'border-gray-200 bg-white hover:border-gray-300'}`}
            onclick={async () => {
              activeSessionId = session.id;
              await loadSessionState(session.id);
            }}
            type="button"
          >
            <div class="font-medium text-gray-900">{getSessionTitle(session, index)}</div>
            {#if getBindingDisplayLabel(session)}
              <div class="mt-1 text-xs text-brand/80">{getBindingDisplayLabel(session)}</div>
            {/if}
            {#if getSessionSubLabel(session)}
              <div class="mt-1 text-[11px] text-gray-400">{getSessionSubLabel(session)}</div>
            {/if}
            <div class="mt-1 text-xs text-gray-500">messages: {session.totalMessages ?? 0} · depth: {session.forkDepth ?? 0}</div>
            {#if session.parentSessionId}
              <div class="mt-1 text-[11px] text-gray-400 break-all">parent: {session.parentSessionId}</div>
            {/if}
          </button>
        {/each}
      {/if}
    </div>
  </aside>

  <section class="flex min-w-0 flex-col bg-[#141414] overflow-hidden">
    <div class="border-b border-white/5 px-6 py-4 text-sm text-white/70">
      {#if activeSessionState}
        <div class="flex items-center justify-between gap-4">
          <div>
            <div class="font-medium text-white">{activeSessionState.session.title || activeSessionState.session.latestMessageText || activeSessionState.session.id}</div>
            {#if getBindingDisplayLabel(activeSessionState.session)}
              <div class="mt-1 text-xs text-brand/80">{getBindingDisplayLabel(activeSessionState.session)}</div>
            {/if}
            {#if getSessionSubLabel(activeSessionState.session)}
              <div class="mt-1 text-[11px] text-white/40">{getSessionSubLabel(activeSessionState.session)}</div>
            {/if}
            {#if getAllBindingDisplayLabels(activeSessionState.session).length > 1}
              <div class="mt-2 flex flex-wrap gap-2">
                {#each getAllBindingDisplayLabels(activeSessionState.session) as label (label)}
                  <span class="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] text-white/65">{label}</span>
                {/each}
              </div>
            {/if}
            <div class="mt-1 text-xs text-white/40 break-all">session: {activeSessionState.session.id}</div>
          </div>
          <div class="flex items-center gap-2">
            <a class="rounded-md border border-white/10 px-3 py-1.5 text-xs text-white/80 hover:bg-white/5" href={`/runtimes/${runtime.id}/graph`}>Session Graph</a>
          </div>
        </div>
      {:else}
        <div class="text-white/50">Select a session.</div>
      {/if}
    </div>

    <div class="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_320px]">
      <div class="flex min-w-0 flex-col overflow-hidden">
        {#if activeSessionState?.error}
          <div class="m-6 rounded-lg border border-red-300/20 bg-red-300/10 p-4 text-sm text-red-100">{activeSessionState.error}</div>
        {:else}
          <ChatTimeline bindListEl={listEl} timeline={timeline} />
        {/if}

        {#if activeSessionState}
          <div class="border-t border-white/5 px-6 py-3">
            <div class="mb-3 flex flex-wrap gap-2">
              {#each activeSessionState.messages as message (message.id)}
                <button
                  class="rounded-md border border-white/10 bg-white/[0.03] px-2 py-1 text-[11px] text-white/70 hover:bg-white/[0.06]"
                  onclick={() => handleFork(message.id)}
                  type="button"
                  title="Fork from this message"
                >
                  fork #{message.sequence}: {(message.text || message.role).slice(0, 32)}
                </button>
              {/each}
            </div>
            <SessionComposer bind:value={input} disabled={sending || !activeSessionState} onsubmit={handleSend} />
          </div>
        {/if}
      </div>

      <aside class="border-l border-white/5 bg-[#101010] p-4 overflow-y-auto">
        <div class="mb-3 text-[11px] font-semibold uppercase tracking-[0.2em] text-white/40">Runtime Channels</div>
        {#if runtimeChannels.length === 0}
          <div class="rounded-lg border border-white/10 bg-white/[0.03] p-3 text-sm text-white/50">No runtime channels bound.</div>
        {:else}
          <div class="space-y-3">
            {#each runtimeChannels as runtimeChannel (runtimeChannel.id)}
              <div class="rounded-xl border border-white/10 bg-white/[0.03] p-4 space-y-3">
                <div>
                  <div class="font-medium text-white">{runtimeChannel.channel?.name || runtimeChannel.channel?.provider || runtimeChannel.id}</div>
                  <div class="mt-1 text-[11px] uppercase tracking-[0.18em] text-white/35">{runtimeChannel.channel?.provider ?? "unknown"}</div>
                  <div class="mt-1 text-[11px] break-all text-white/30">{runtimeChannel.id}</div>
                </div>

                {#if runtimeChannel.channel?.provider === "discord"}
                  {@const config = getDiscordRuntimeChannelConfig(runtimeChannel)}
                  <div class="space-y-3">
                    <div>
                      <div class="text-[11px] uppercase tracking-[0.18em] text-white/35">Inbound</div>
                      <label class="mt-2 flex items-center gap-3 text-sm text-white/75">
                        <input
                          type="checkbox"
                          checked={config.inbound?.requireMentionInGuild !== false}
                          onchange={(event) => patchDiscordRuntimeChannelConfig(runtimeChannel, (current) => ({
                            ...current,
                            inbound: {
                              ...(current.inbound ?? {}),
                              requireMentionInGuild: (event.currentTarget as HTMLInputElement).checked,
                            },
                          }))}
                          class="rounded border-white/20 bg-transparent text-brand focus:ring-brand"
                        />
                        Require mention in non-DM messages
                      </label>
                    </div>

                    <div>
                      <div class="text-[11px] uppercase tracking-[0.18em] text-white/35">Outbound</div>
                      <div class="mt-2 space-y-2">
                        <label class="flex items-center gap-3 text-sm text-white/75">
                          <input
                            type="checkbox"
                            checked={config.outbound?.showThinking === true}
                            onchange={(event) => patchDiscordRuntimeChannelConfig(runtimeChannel, (current) => ({
                              ...current,
                              outbound: {
                                ...(current.outbound ?? {}),
                                showThinking: (event.currentTarget as HTMLInputElement).checked,
                              },
                            }))}
                            class="rounded border-white/20 bg-transparent text-brand focus:ring-brand"
                          />
                          Show thinking
                        </label>
                        <label class="flex items-center gap-3 text-sm text-white/75">
                          <input
                            type="checkbox"
                            checked={config.outbound?.showToolCalls === true}
                            onchange={(event) => patchDiscordRuntimeChannelConfig(runtimeChannel, (current) => ({
                              ...current,
                              outbound: {
                                ...(current.outbound ?? {}),
                                showToolCalls: (event.currentTarget as HTMLInputElement).checked,
                              },
                            }))}
                            class="rounded border-white/20 bg-transparent text-brand focus:ring-brand"
                          />
                          Show tool calls
                        </label>
                        <div>
                          <div class="mb-1 block text-sm font-medium text-white/75">Default display mode</div>
                          <select
                            value={config.outbound?.defaultDisplayMode ?? "minimal"}
                            onchange={(event) => patchDiscordRuntimeChannelConfig(runtimeChannel, (current) => ({
                              ...current,
                              outbound: {
                                ...(current.outbound ?? {}),
                                defaultDisplayMode: (event.currentTarget as HTMLSelectElement).value as "full" | "compact" | "minimal",
                              },
                            }))}
                            class="w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white outline-none focus:border-brand"
                          >
                            <option value="minimal">minimal</option>
                            <option value="compact">compact</option>
                            <option value="full">full</option>
                          </select>
                        </div>
                      </div>
                    </div>
                  </div>
                {:else}
                  <div class="text-sm text-white/45">No editable provider config yet.</div>
                {/if}

                {#if savingChannelConfigById[runtimeChannel.id]}
                  <div class="text-[11px] text-white/35">Saving...</div>
                {/if}
                {#if channelConfigErrorById[runtimeChannel.id]}
                  <div class="text-[11px] break-all text-red-300">{channelConfigErrorById[runtimeChannel.id]}</div>
                {/if}
              </div>
            {/each}
          </div>
        {/if}
      </aside>
    </div>
  </section>
</div>
