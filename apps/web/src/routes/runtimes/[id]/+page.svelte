<script lang="ts">
import { onMount, tick } from "svelte";
import {
  getRuntime,
  getRuntimeChannels,
  getRuntimeProvisioning,
  getRuntimeSessions,
  getSessionMessages,
  updateRuntimeChannelConfig,
  createSessionResponseStream,
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
import { Terminal, Activity, Box, Hash, MessageSquare, ArrowLeft, X } from "lucide-svelte";

type Props = {
  data: {
    runtimeId: string;
  };
};

type SessionViewState = {
  session: SessionRecord;
  messages: SessionMessageRecord[];
  toolCalls: SessionToolCallRecord[];
  loading: boolean;
  loaded: boolean;
  error: string;
};

const props = $props();
const data = $derived((props as Props).data);
const runtimeId = $derived(data.runtimeId);

let runtime = $state<RuntimeRecord | null>(null);
let runtimeSessions = $state<SessionRecord[]>([]);
let runtimeChannels = $state<RuntimeChannelRecord[]>([]);
let sessionStateById = $state<Record<string, SessionViewState>>({});
let activeSessionId = $state<string | null>(null);
let openedSessionIds = $state<string[]>([]);
let input = $state("");
let sending = $state(false);
let runtimeLoadError = $state("");
let streamStatus = $state<"idle" | "streaming" | "done" | "error">("idle");
let streamError = $state("");
let provisioning = $state<RuntimeProvisionResponse | null>(null);
let provisioningError = $state("");
let streamingAssistantText = $state("");
let provisioningPollingTimer: ReturnType<typeof setInterval> | null = null;
let listEl = $state<HTMLDivElement | null>(null);
let contentEl = $state<HTMLDivElement | null>(null);
let savingChannelConfigById = $state<Record<string, boolean>>({});
let channelConfigErrorById = $state<Record<string, string>>({});
let loadingSessionIds = $state<Record<string, boolean>>({});
let bootstrapping = $state(true);
let didInitialScrollBySession = $state<Record<string, boolean>>({});
let shouldAutoFollow = $state(true);

const activeSessionState = $derived(activeSessionId ? sessionStateById[activeSessionId] ?? null : null);
const openedSessions = $derived(
  openedSessionIds
    .map((id) => sessionStateById[id]?.session ?? runtimeSessions.find((session) => session.id === id) ?? null)
    .filter(Boolean) as SessionRecord[],
);
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
  const candidates = [
    session.title,
    session.latestMessageText,
  ];

  for (const candidate of candidates) {
    const normalized = candidate
      ?.replace(/\s+/g, " ")
      .replace(/^[:\-\s]+/, "")
      .trim();

    if (normalized) {
      return normalized.slice(0, 48);
    }
  }

  return `Session ${index + 1}`;
}

function ensureSessionOpened(sessionId: string) {
  if (!openedSessionIds.includes(sessionId)) {
    openedSessionIds = [...openedSessionIds, sessionId];
  }
}

function openSession(sessionId: string) {
  activeSessionId = sessionId;
  shouldAutoFollow = true;
  didInitialScrollBySession = { ...didInitialScrollBySession, [sessionId]: false };
  ensureSessionOpened(sessionId);
}

function closeSessionTab(sessionId: string) {
  const next = openedSessionIds.filter((id) => id !== sessionId);
  openedSessionIds = next;

  if (activeSessionId === sessionId) {
    activeSessionId = next.at(-1) ?? runtimeSessions.at(-1)?.id ?? null;
    if (activeSessionId) {
      ensureSessionOpened(activeSessionId);
    }
  }
}

function seedSessions(sessions: SessionRecord[]) {
  if (sessions.length === 0 && runtimeSessions.length > 0) {
    return;
  }

  runtimeSessions = sessions;
  const nextState = { ...sessionStateById };
  for (const session of sessions) {
    if (!nextState[session.id]) {
      nextState[session.id] = {
        session,
        messages: [],
        toolCalls: [],
        loading: false,
        loaded: false,
        error: "",
      };
    } else {
      nextState[session.id] = {
        ...nextState[session.id],
        session,
      };
    }
  }
  sessionStateById = nextState;
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
  runtimeLoadError = "";

  const [runtimeResult, sessionsResult, channelsResult] = await Promise.allSettled([
    getRuntime(runtimeId),
    getRuntimeSessions(runtimeId),
    getRuntimeChannels(runtimeId),
  ]);

  if (runtimeResult.status === "fulfilled") {
    runtime = runtimeResult.value;
  } else {
    runtimeLoadError = runtimeResult.reason instanceof Error
      ? runtimeResult.reason.message
      : "Failed to load runtime";
  }

  if (sessionsResult.status === "fulfilled") {
    const sessions = sessionsResult.value.sessions ?? [];
    seedSessions(sessions);

    if (!activeSessionId && sessions.length > 0) {
      const nextId = sessions.at(-1)?.id ?? null;
      activeSessionId = nextId;
      if (nextId) {
        openedSessionIds = [nextId];
      }
    }
  } else if (!runtimeLoadError) {
    runtimeLoadError = sessionsResult.reason instanceof Error
      ? sessionsResult.reason.message
      : "Failed to load runtime sessions";
  }

  if (channelsResult.status === "fulfilled") {
    runtimeChannels = channelsResult.value;
  } else if (!runtimeLoadError) {
    runtimeLoadError = channelsResult.reason instanceof Error
      ? channelsResult.reason.message
      : "Failed to load runtime channels";
  }
}

async function loadSessionState(sessionId: string, force = false) {
  const existing = sessionStateById[sessionId];
  if (loadingSessionIds[sessionId] && !force) return;
  if (existing?.loaded && !force) return;

  const fallbackSession = runtimeSessions.find((item) => item.id === sessionId) ?? existing?.session;
  if (!fallbackSession) return;

  loadingSessionIds = { ...loadingSessionIds, [sessionId]: true };
  sessionStateById = {
    ...sessionStateById,
    [sessionId]: {
      session: existing?.session ?? fallbackSession,
      messages: existing?.messages ?? [],
      toolCalls: existing?.toolCalls ?? [],
      loading: true,
      loaded: false,
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
        loaded: true,
        error: "",
      },
    };

    if (activeSessionId === sessionId) {
      void forceScrollToBottom().then(() => {
        shouldAutoFollow = true;
        didInitialScrollBySession = { ...didInitialScrollBySession, [sessionId]: true };
      });
    }
  } catch (error) {
    sessionStateById = {
      ...sessionStateById,
      [sessionId]: {
        session: existing?.session ?? fallbackSession,
        messages: existing?.messages ?? [],
        toolCalls: existing?.toolCalls ?? [],
        loading: false,
        loaded: true,
        error: error instanceof Error ? error.message : "Failed to load session",
      },
    };
  } finally {
    loadingSessionIds = { ...loadingSessionIds, [sessionId]: false };
  }
}

async function loadProvisioning() {
  try {
    provisioning = await getRuntimeProvisioning(runtimeId);
    provisioningError = "";
  } catch (error) {
    provisioningError = error instanceof Error ? error.message : "Failed to load provisioning";
  }
}


function shouldPollProvisioning(provision: RuntimeProvisionResponse | null) {
  if (!provision) return true;
  return provision.status === "queued" || provision.status === "running";
}

async function handleSend() {
  if (!activeSessionState || !input.trim() || sending || !runtime) return;
  sending = true;
  streamError = "";
  streamStatus = "streaming";

  const text = input.trim();
  const sessionId = activeSessionState.session.id;

  try {
    input = "";
    streamingAssistantText = "";

    const currentState = sessionStateById[sessionId];
    if (currentState) {
      sessionStateById = {
        ...sessionStateById,
        [sessionId]: {
          ...currentState,
          messages: [
            ...currentState.messages,
            {
              id: `optimistic-user-${Date.now()}`,
              sessionId,
              role: "user",
              content: [{ type: "text", text }],
              text,
              externalMessageId: null,
              protocolMessageId: null,
              sequence: (currentState.messages.at(-1)?.sequence ?? 0) + 1,
              prevMessageId: currentState.messages.at(-1)?.id ?? null,
              provider: null,
              model: null,
              stopReason: null,
              errorMessage: null,
              usageInput: null,
              usageOutput: null,
              usageTotalTokens: null,
              costTotal: null,
              createdAt: new Date().toISOString(),
            },
          ],
        },
      };
    }

    for await (const event of createSessionResponseStream({
      runtimeId: runtime.id,
      sessionId,
      text,
    })) {
      if (event.type === "response.output_text.delta") {
        streamingAssistantText = `${streamingAssistantText}${event.delta}`;
        await tick();
        if (shouldAutoFollow) {
          scrollToBottomNow();
        }
      }

      if (event.type === "response.failed") {
        streamError = event.response.error?.message ?? "Response failed";
        streamStatus = "error";
      }

      if (event.type === "response.completed") {
        streamStatus = "done";
      }
    }

    streamingAssistantText = "";
    await loadSessionState(sessionId, true);
    await loadRuntime();
  } catch (error) {
    streamError = error instanceof Error ? error.message : "Failed to send message";
    streamStatus = "error";
    await loadSessionState(sessionId, true).catch(() => undefined);
  } finally {
    streamingAssistantText = "";
    sending = false;
  }
}

function scrollToBottomNow() {
  if (!listEl) return;
  const target = contentEl?.scrollHeight ?? listEl.scrollHeight;
  listEl.scrollTop = target;
}

async function forceScrollToBottom() {
  await tick();
  scrollToBottomNow();
  requestAnimationFrame(() => {
    scrollToBottomNow();
    setTimeout(() => {
      scrollToBottomNow();
    }, 0);
  });
}

function runtimeStatusColor(status: string) {
  if (status === "running") return "text-emerald-400";
  if (status === "starting" || status === "active") return "text-amber-400";
  if (status === "error" || status === "boot_failed") return "text-rose-400";
  if (status === "hibernated") return "text-gray-400";
  if (status === "hibernating") return "text-blue-400";
  return "text-white/40";
}

function updateAutoFollow() {
  if (!listEl) return;
  const threshold = 80;
  const distanceFromBottom = listEl.scrollHeight - listEl.scrollTop - listEl.clientHeight;
  shouldAutoFollow = distanceFromBottom <= threshold;
}

onMount(() => {
  void Promise.all([loadRuntime(), loadProvisioning()]).finally(() => {
    bootstrapping = false;
  });

  provisioningPollingTimer = setInterval(() => {
    if (!shouldPollProvisioning(provisioning)) return;
    void loadProvisioning();
  }, 5000);

  return () => {
    if (provisioningPollingTimer) clearInterval(provisioningPollingTimer);
  };
});

$effect(() => {
  if (activeSessionId) {
    ensureSessionOpened(activeSessionId);
    void loadSessionState(activeSessionId).finally(() => {
      bootstrapping = false;
    });
  }
});

$effect(() => {
  if (!listEl || !activeSessionId) return;
  const sessionId = activeSessionId;
  const state = sessionStateById[sessionId];
  if (!state?.loaded || didInitialScrollBySession[sessionId]) return;

  void forceScrollToBottom().then(() => {
    shouldAutoFollow = true;
    didInitialScrollBySession = { ...didInitialScrollBySession, [sessionId]: true };
  });
});

$effect(() => {
  if (!listEl || !shouldAutoFollow) return;
  queueMicrotask(() => {
    scrollToBottomNow();
  });
});
</script>

<div class="h-screen w-full flex flex-col bg-[#0A0A0A] text-white/80 font-sans text-sm selection:bg-white/20">
  <header class="h-10 flex items-center justify-between px-3 border-b border-white/10 shrink-0 bg-[#0A0A0A]">
    <div class="flex items-center gap-3 min-w-0">
      <a href="/runtimes" class="text-white/40 hover:text-white transition-colors shrink-0" title="Back to runtimes">
        <ArrowLeft class="w-4 h-4" />
      </a>
      <div class="w-[1px] h-4 bg-white/10 shrink-0"></div>
      <Terminal class="w-4 h-4 text-white/50 shrink-0" />
      <span class="font-mono text-xs text-white/90 truncate max-w-[260px]">{runtime?.title || runtime?.id || runtimeId}</span>
      <div class="hidden md:flex items-center gap-1.5 ml-2 px-2 py-0.5 rounded bg-white/5 border border-white/5 shrink-0">
        <div class="w-1.5 h-1.5 rounded-full bg-current {runtimeStatusColor(runtime?.liveStatus ?? runtime?.status ?? 'unknown')}"></div>
        <span class="text-[10px] uppercase tracking-wider font-medium text-white/60">
          {runtime?.liveStatus ?? runtime?.status ?? "unknown"}
        </span>
      </div>
    </div>

    <div class="flex items-center gap-4 text-xs font-mono text-white/40 shrink-0">
      <div class="flex items-center gap-1.5">
        <Activity class="w-3.5 h-3.5" />
        <span class={streamStatus === 'done' ? 'text-emerald-400' : streamStatus === 'streaming' ? 'text-amber-400' : streamStatus === 'error' ? 'text-rose-400' : 'text-white/40'}>{streamStatus}</span>
      </div>
    </div>
  </header>

  <div class="flex-1 flex min-h-0">
    <aside class="w-56 md:w-60 flex flex-col border-r border-white/10 bg-[#0A0A0A] shrink-0">
      <div class="h-9 flex items-center px-3 border-b border-white/5 text-[11px] font-medium uppercase tracking-wider text-white/40 select-none">
        <MessageSquare class="w-3.5 h-3.5 mr-2" />
        Sessions
      </div>

      <div class="flex-1 overflow-y-auto p-2 space-y-0.5">
        {#if bootstrapping && runtimeSessions.length === 0}
          <div class="px-3 py-4 text-xs text-white/30 text-center">Loading sessions...</div>
        {:else if runtimeSessions.length === 0}
          <div class="px-3 py-4 text-xs text-white/30 text-center">No sessions yet</div>
        {:else}
          {#each runtimeSessions as session, index (session.id)}
            <button
              class={`w-full flex flex-col px-3 py-2 rounded-md text-left transition-colors relative ${activeSessionId === session.id ? 'bg-[#1A1A1A] text-white border border-white/10' : 'text-white/60 hover:bg-white/5 border border-transparent'}`}
              onclick={() => openSession(session.id)}
              type="button"
            >
              {#if activeSessionId === session.id}
                <div class="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full bg-emerald-400"></div>
              {/if}
              <div class="flex items-center gap-2 w-full">
                <div class="text-xs font-medium truncate flex-1">{getSessionTitle(session, index)}</div>
                {#if loadingSessionIds[session.id]}
                  <div class="w-3 h-3 rounded-full border border-white/15 border-t-emerald-400 animate-spin shrink-0"></div>
                {/if}
              </div>
            </button>
          {/each}
        {/if}
      </div>
    </aside>

    <main class="flex-1 flex flex-col min-w-0 bg-[#0F0F0F]">
      <div class="h-9 flex items-center border-b border-white/10 bg-[#0A0A0A] overflow-x-auto">
        {#if openedSessions.length === 0}
          <div class="px-4 text-[11px] text-white/30">{bootstrapping ? 'Loading session...' : 'No open session'}</div>
        {:else}
          {#each openedSessions as session, index (session.id)}
            <button
              type="button"
              class={`group flex items-center h-full px-3 border-r border-white/10 min-w-36 max-w-xs ${activeSessionId === session.id ? 'bg-[#0F0F0F] border-t-2 border-t-emerald-500/50 text-white/92' : 'bg-[#0A0A0A] text-white/45 hover:text-white/72'}`}
              onclick={() => openSession(session.id)}
            >
              <span class="text-xs truncate mr-3">{getSessionTitle(session, index)}</span>
              <span class="text-[10px] text-white/22 font-mono mr-2 hidden xl:inline">{session.id.slice(0, 6)}</span>
              {#if openedSessions.length > 1}
                <span
                  role="button"
                  tabindex="0"
                  class="ml-auto rounded-sm p-0.5 text-white/25 hover:text-white/70 hover:bg-white/8"
                  onclick={(event) => {
                    event.stopPropagation();
                    closeSessionTab(session.id);
                  }}
                  onkeydown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      event.stopPropagation();
                      closeSessionTab(session.id);
                    }
                  }}
                >
                  <X class="w-3 h-3" />
                </span>
              {/if}
            </button>
          {/each}
        {/if}
      </div>

      <div class="flex-1 flex flex-col min-h-0 relative">
        {#if bootstrapping && !activeSessionState}
          <div class="absolute inset-0 flex items-center justify-center bg-[#0F0F0F]">
            <div class="flex flex-col items-center gap-3 text-white/35">
              <div class="w-8 h-8 rounded-full border-2 border-white/15 border-t-emerald-400 animate-spin"></div>
              <div class="text-xs font-mono">Loading runtime…</div>
            </div>
          </div>
        {:else if !activeSessionState}
          <div class="absolute inset-0 flex items-center justify-center text-white/30 text-sm">
            Select a session to start
          </div>
        {:else if activeSessionState.loading && !activeSessionState.loaded}
          <div class="absolute inset-0 flex items-center justify-center bg-[#0F0F0F] z-10">
            <div class="flex flex-col items-center gap-3 text-white/35">
              <div class="w-7 h-7 rounded-full border-2 border-white/12 border-t-emerald-400 animate-spin"></div>
              <div class="text-xs font-mono">Loading messages…</div>
            </div>
          </div>
        {:else}
          {#if activeSessionState.error}
            <div class="m-4 rounded-md border border-rose-500/20 bg-rose-500/10 p-3 text-xs font-mono text-rose-400 break-all">
              {activeSessionState.error}
            </div>
          {/if}

          <ChatTimeline bindListEl={listEl} bindContentEl={contentEl} timeline={timeline} onScrollChange={updateAutoFollow} />

          <div class="border-t border-white/10 bg-[#0A0A0A]">
            <SessionComposer bind:value={input} disabled={sending || !activeSessionState} streamError={streamError} onsubmit={handleSend} />
          </div>
        {/if}
      </div>
    </main>

    <aside class="hidden xl:flex w-72 flex-col border-l border-white/10 bg-[#0A0A0A] shrink-0 overflow-y-auto">
      <div class="h-9 flex items-center px-3 border-b border-white/5 text-[11px] font-medium uppercase tracking-wider text-white/40 select-none sticky top-0 bg-[#0A0A0A] z-10">
        <Box class="w-3.5 h-3.5 mr-2" />
        Inspector
      </div>

      <div class="p-4 space-y-6">
        <section class="space-y-2">
          <div class="text-[10px] font-bold text-white/30 uppercase tracking-widest">Runtime</div>
          <div class="rounded-md border border-white/8 bg-white/[0.02] p-3 space-y-2">
            <div class="text-[10px] text-white/35 uppercase tracking-wider">ID</div>
            <div class="text-xs text-white/70 break-all font-mono">{runtime?.id || runtimeId}</div>
            <div class="pt-1 grid grid-cols-2 gap-2 text-[11px]">
              <div>
                <div class="text-white/30">status</div>
                <div class={runtimeStatusColor(runtime?.liveStatus ?? runtime?.status ?? 'unknown')}>{runtime?.liveStatus ?? runtime?.status ?? 'unknown'}</div>
              </div>
              <div>
                <div class="text-white/30">stream</div>
                <div class={streamStatus === 'done' ? 'text-emerald-400' : streamStatus === 'streaming' ? 'text-amber-400' : streamStatus === 'error' ? 'text-rose-400' : 'text-white/40'}>{streamStatus}</div>
              </div>
            </div>
          </div>
        </section>

        <section class="space-y-2">
          <div class="text-[10px] font-bold text-white/30 uppercase tracking-widest">Provisioning</div>
          <div class="rounded-md border border-white/8 bg-white/[0.02] p-3 space-y-2">
            {#if provisioning}
              <div>
                <div class="text-[10px] text-white/35 uppercase tracking-wider">Current step</div>
                <div class="mt-1 text-xs text-white/80">{provisioning.currentStep}</div>
              </div>
              <div>
                <div class="text-[10px] text-white/35 uppercase tracking-wider">Status</div>
                <div class="mt-1 text-xs text-white/70">{provisioning.status}</div>
              </div>
            {:else}
              <div class="text-xs text-white/35">No provisioning data.</div>
            {/if}
            {#if provisioningError}
              <div class="text-[11px] text-rose-400 break-all">{provisioningError}</div>
            {/if}
            {#if runtimeLoadError}
              <div class="text-[11px] text-rose-400 break-all">{runtimeLoadError}</div>
            {/if}
          </div>
        </section>

        <section class="space-y-3">
          <div class="text-[10px] font-bold text-white/30 uppercase tracking-widest flex items-center justify-between">
            <span>Channels</span>
            <span class="px-1.5 py-0.5 rounded-sm bg-white/10 text-white/55">{runtimeChannels.length}</span>
          </div>

          {#if runtimeChannels.length === 0}
            <div class="rounded-md border border-white/8 bg-white/[0.02] p-3 text-xs text-white/35">No channels bound.</div>
          {:else}
            <div class="space-y-3">
              {#each runtimeChannels as runtimeChannel (runtimeChannel.id)}
                <div class="border border-white/10 rounded-md bg-[#121212] overflow-hidden">
                  <div class="px-3 py-2 border-b border-white/5 bg-[#1A1A1A] flex items-center gap-2">
                    <Hash class="w-3 h-3 text-white/40" />
                    <span class="text-xs font-medium text-white/80 truncate">{runtimeChannel.channel?.name || runtimeChannel.channel?.provider}</span>
                  </div>

                  <div class="p-3">
                    {#if runtimeChannel.channel?.provider === "discord"}
                      {@const config = getDiscordRuntimeChannelConfig(runtimeChannel)}
                      <div class="space-y-4">
                        <label class="flex items-start gap-2 cursor-pointer group">
                          <input
                            type="checkbox"
                            checked={config.inbound?.requireMentionInGuild !== false}
                            onchange={(event) => patchDiscordRuntimeChannelConfig(runtimeChannel, (current) => ({
                              ...current,
                              inbound: { ...(current.inbound ?? {}), requireMentionInGuild: (event.currentTarget as HTMLInputElement).checked },
                            }))}
                            class="mt-0.5 rounded-sm bg-black border-white/20 checked:bg-emerald-500 checked:border-emerald-500"
                          />
                          <div class="flex flex-col min-w-0">
                            <span class="text-xs text-white/70 group-hover:text-white transition-colors">Require mention in Guild</span>
                            <span class="text-[10px] text-white/28">Respond only when mentioned</span>
                          </div>
                        </label>

                        <div class="w-full h-px bg-white/5"></div>

                        <label class="flex items-start gap-2 cursor-pointer group">
                          <input
                            type="checkbox"
                            checked={config.outbound?.showThinking === true}
                            onchange={(event) => patchDiscordRuntimeChannelConfig(runtimeChannel, (current) => ({
                              ...current,
                              outbound: { ...(current.outbound ?? {}), showThinking: (event.currentTarget as HTMLInputElement).checked },
                            }))}
                            class="mt-0.5 rounded-sm bg-black border-white/20 checked:bg-emerald-500 checked:border-emerald-500"
                          />
                          <div class="flex flex-col">
                            <span class="text-xs text-white/70 group-hover:text-white transition-colors">Show thinking</span>
                          </div>
                        </label>

                        <label class="flex items-start gap-2 cursor-pointer group">
                          <input
                            type="checkbox"
                            checked={config.outbound?.showToolCalls === true}
                            onchange={(event) => patchDiscordRuntimeChannelConfig(runtimeChannel, (current) => ({
                              ...current,
                              outbound: { ...(current.outbound ?? {}), showToolCalls: (event.currentTarget as HTMLInputElement).checked },
                            }))}
                            class="mt-0.5 rounded-sm bg-black border-white/20 checked:bg-emerald-500 checked:border-emerald-500"
                          />
                          <div class="flex flex-col">
                            <span class="text-xs text-white/70 group-hover:text-white transition-colors">Show tool calls</span>
                          </div>
                        </label>
                      </div>
                    {:else}
                      <div class="text-xs text-white/35">No configuration available.</div>
                    {/if}

                    {#if savingChannelConfigById[runtimeChannel.id]}
                      <div class="mt-3 text-[10px] text-emerald-400/70">Saving changes...</div>
                    {/if}
                    {#if channelConfigErrorById[runtimeChannel.id]}
                      <div class="mt-3 text-[10px] text-rose-400 break-all">{channelConfigErrorById[runtimeChannel.id]}</div>
                    {/if}
                  </div>
                </div>
              {/each}
            </div>
          {/if}
        </section>
      </div>
    </aside>
  </div>
</div>
