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
import { toChatMessages, type TimelineItem } from "$lib/session-tree";

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

function runtimeStatusBadge(status: string) {
  if (status === "running") return "neo-badge neo-badge-green";
  if (status === "starting" || status === "active") return "neo-badge neo-badge-yellow";
  if (status === "error") return "neo-badge neo-badge-red";
  return "neo-badge neo-badge-white";
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

<div class="h-[calc(100vh-4rem)] min-h-0 pb-4">
  <div class="grid h-full min-h-0 gap-4 xl:grid-cols-[220px_minmax(0,1fr)_280px]">
    <aside class="neo-card min-h-0 overflow-hidden neo-fill-paper hidden xl:block">
      <div class="border-b-[4px] border-black px-4 py-3 neo-fill-yellow">
        <h1 class="text-lg font-black uppercase tracking-tight line-clamp-2">{runtime.title || "Untitled Runtime"}</h1>
        <div class="mt-2 text-[11px] font-mono break-all text-black/55">{runtime.id}</div>
        <div class="mt-2 flex flex-wrap gap-2">
          <span class={runtimeStatusBadge(runtime.liveStatus ?? runtime.status ?? "unknown")}>{runtime.liveStatus ?? runtime.status ?? "unknown"}</span>
          <span class="neo-badge neo-badge-white">stream: {streamStatus}</span>
        </div>
        {#if provisioning}
          <div class="mt-2 text-[11px] font-bold text-black/65">Provision: {provisioning.status} · {provisioning.currentStep}</div>
        {/if}
        {#if provisioningError}
          <div class="mt-2 text-[11px] font-bold text-red-600 break-all">{provisioningError}</div>
        {/if}
        {#if runtimeLoadError}
          <div class="mt-2 text-[11px] font-bold text-red-600 break-all">{runtimeLoadError}</div>
        {/if}
      </div>

      <div class="px-3 py-3 min-h-0 overflow-y-auto h-[calc(100%-122px)]">
        <div class="neo-meta mb-3">Sessions</div>
        <div class="space-y-2">
          {#if runtimeSessions.length === 0}
            <div class="neo-card-sm p-3 bg-white text-xs font-bold text-black/60">No sessions yet.</div>
          {:else}
            {#each runtimeSessions as session, index (session.id)}
              <button
                class={`w-full rounded-2xl border-[3px] p-3 text-left transition-all ${activeSessionId === session.id ? 'border-black bg-[#FF85B3] shadow-[4px_4px_0_0_#000]' : 'border-black bg-white shadow-[3px_3px_0_0_#000] hover:-translate-x-1 hover:-translate-y-1 hover:shadow-[5px_5px_0_0_#000] active:translate-x-1 active:translate-y-1 active:shadow-none'}`}
                onclick={async () => {
                  activeSessionId = session.id;
                  await loadSessionState(session.id);
                }}
                type="button"
              >
                <div class="font-black uppercase tracking-tight line-clamp-2">{getSessionTitle(session, index)}</div>
                {#if getBindingDisplayLabel(session)}
                  <div class="mt-2 text-[11px] font-bold text-black/70">{getBindingDisplayLabel(session)}</div>
                {/if}
                {#if getSessionSubLabel(session)}
                  <div class="mt-1 text-[11px] font-bold text-black/50">{getSessionSubLabel(session)}</div>
                {/if}
                <div class="mt-2 text-[11px] font-bold text-black/60">msgs: {session.totalMessages ?? 0} · depth: {session.forkDepth ?? 0}</div>
              </button>
            {/each}
          {/if}
        </div>
      </div>
    </aside>

    <section class="neo-card min-h-0 overflow-hidden bg-white flex flex-col">
      <div class="border-b-[4px] border-black px-4 py-3 neo-fill-blue flex items-start justify-between gap-3">
        {#if activeSessionState}
          <div class="min-w-0">
            <div class="text-lg font-black uppercase tracking-tight line-clamp-2">{activeSessionState.session.title || activeSessionState.session.latestMessageText || activeSessionState.session.id}</div>
            <div class="mt-1 text-[11px] font-mono break-all text-black/55">session: {activeSessionState.session.id}</div>
            {#if getAllBindingDisplayLabels(activeSessionState.session).length > 0}
              <div class="mt-2 flex flex-wrap gap-2">
                {#each getAllBindingDisplayLabels(activeSessionState.session) as label (label)}
                  <span class="neo-badge neo-badge-white normal-case tracking-normal">{label}</span>
                {/each}
              </div>
            {/if}
          </div>
          <a class="neo-btn neo-btn-secondary !px-3 !py-2 text-xs shrink-0" href={`/runtimes/${runtime.id}/graph`}>Session Graph</a>
        {:else}
          <div class="font-black uppercase tracking-tight">Select a session</div>
        {/if}
      </div>

      <div class="min-h-0 flex-1 flex flex-col bg-[#FFF9F0]">
        {#if activeSessionState?.error}
          <div class="m-4 neo-card-sm neo-fill-red p-4 text-sm font-bold text-white">{activeSessionState.error}</div>
        {:else}
          <ChatTimeline bindListEl={listEl} timeline={timeline} />
        {/if}

        {#if activeSessionState}
          <div class="border-t-[4px] border-black px-4 py-3 bg-white">
            {#if activeSessionState.messages.length > 0}
              <div class="mb-3 flex flex-wrap gap-2 max-h-24 overflow-y-auto pr-1">
                {#each activeSessionState.messages as message (message.id)}
                  <button
                    class="neo-badge neo-badge-white normal-case tracking-normal hover:-translate-x-0.5 hover:-translate-y-0.5 transition-all"
                    onclick={() => handleFork(message.id)}
                    type="button"
                    title="Fork from this message"
                  >
                    fork #{message.sequence}
                  </button>
                {/each}
              </div>
            {/if}
            <SessionComposer bind:value={input} disabled={sending || !activeSessionState} streamError={streamError} onsubmit={handleSend} />
          </div>
        {/if}
      </div>
    </section>

    <aside class="neo-card min-h-0 overflow-hidden bg-white hidden xl:block">
      <div class="border-b-[4px] border-black px-4 py-3 neo-fill-purple text-white">
        <div class="neo-meta text-white">Runtime Channels</div>
      </div>
      <div class="p-3 space-y-3 min-h-0 overflow-y-auto h-[calc(100%-58px)]">
        {#if runtimeChannels.length === 0}
          <div class="neo-card-sm p-3 neo-fill-paper text-xs font-bold text-black/60">No runtime channels bound.</div>
        {:else}
          {#each runtimeChannels as runtimeChannel (runtimeChannel.id)}
            <div class="neo-card-sm p-3 neo-fill-paper space-y-3">
              <div>
                <div class="font-black uppercase tracking-tight">{runtimeChannel.channel?.name || runtimeChannel.channel?.provider || runtimeChannel.id}</div>
                <div class="mt-1 text-[11px] font-bold uppercase tracking-widest text-black/50">{runtimeChannel.channel?.provider ?? "unknown"}</div>
                <div class="mt-1 text-[11px] font-mono break-all text-black/45">{runtimeChannel.id}</div>
              </div>

              {#if runtimeChannel.channel?.provider === "discord"}
                {@const config = getDiscordRuntimeChannelConfig(runtimeChannel)}
                <div class="space-y-3">
                  <div>
                    <div class="neo-meta mb-2">Inbound</div>
                    <label class="flex items-start gap-3 text-sm font-bold text-black/75 rounded-2xl border-[3px] border-black bg-white px-3 py-3">
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
                        class="mt-0.5 h-4 w-4 accent-black"
                      />
                      <span>Require mention in non-DM messages</span>
                    </label>
                  </div>

                  <div>
                    <div class="neo-meta mb-2">Outbound</div>
                    <div class="space-y-2">
                      <label class="flex items-start gap-3 text-sm font-bold text-black/75 rounded-2xl border-[3px] border-black bg-white px-3 py-3">
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
                          class="mt-0.5 h-4 w-4 accent-black"
                        />
                        <span>Show thinking</span>
                      </label>
                      <label class="flex items-start gap-3 text-sm font-bold text-black/75 rounded-2xl border-[3px] border-black bg-white px-3 py-3">
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
                          class="mt-0.5 h-4 w-4 accent-black"
                        />
                        <span>Show tool calls</span>
                      </label>
                    </div>
                  </div>
                </div>
              {:else}
                <div class="text-sm font-bold text-black/50">No editable provider config yet.</div>
              {/if}

              {#if savingChannelConfigById[runtimeChannel.id]}
                <div class="text-[11px] font-bold text-black/45">Saving...</div>
              {/if}
              {#if channelConfigErrorById[runtimeChannel.id]}
                <div class="text-[11px] font-bold break-all text-red-600">{channelConfigErrorById[runtimeChannel.id]}</div>
              {/if}
            </div>
          {/each}
        {/if}
      </div>
    </aside>
  </div>
</div>
