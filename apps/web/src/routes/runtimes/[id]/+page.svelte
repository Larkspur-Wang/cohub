<script lang="ts">
import { onMount, tick } from "svelte";
import { page } from "$app/state";
import { goto } from "$app/navigation";
import {
  getRuntime,
  getRuntimeChannels,
  getRuntimeProvisioning,
  getRuntimeSessions,
  getSessionMessages,
  postSessionMessage,
  updateRuntimeChannelConfig,
  createRuntimeSession,
  streamRuntimeEvents,
  type RuntimeChannelConfigInput,
  type RuntimeChannelRecord,
  type RuntimeProvisionResponse,
  type RuntimeRecord,
  type SessionRecord,
  type SessionMessageRecord,
  type RuntimeStreamEvent,
} from "$lib/api";
import ChatTimeline from "$lib/components/ChatTimeline.svelte";
import SessionComposer from "$lib/components/SessionComposer.svelte";
import { toChatMessages, type TimelineItem } from "$lib/session-tree";
import { Terminal, Hash, X, Plus, ArrowDown, Settings } from "lucide-svelte";
import { ensureAuth } from "$lib/auth";

type Props = {
  data: {
    runtimeId: string;
  };
};

type SessionViewState = {
  session: SessionRecord;
  messages: SessionMessageRecord[];
  loading: boolean;
  loaded: boolean;
  error: string;
};

const props = $props();
const data = $derived((props as Props).data);
const runtimeId = $derived(data.runtimeId);

// Session from URL query param
const urlSessionId = $derived(page.url.searchParams.get("session"));

let runtime = $state<RuntimeRecord | null>(null);
let runtimeSessions = $state<SessionRecord[]>([]);
let runtimeChannels = $state<RuntimeChannelRecord[]>([]);
let sessionStateById = $state<Record<string, SessionViewState>>({});
let activeSessionId = $state<string | null>(null);
let input = $state("");
let sending = $state(false);
let runtimeLoadError = $state("");
let streamStatus = $state<"idle" | "streaming" | "done" | "error">("idle");
let streamError = $state("");
let provisioning = $state<RuntimeProvisionResponse | null>(null);
let provisioningError = $state("");
let streamingAssistantText = $state("");
let streamingThinking = $state("");
let streamingToolCalls = $state<Array<{ toolCallId: string; toolName: string; status: string; summary?: string }>>([]);

// SSE
let sseAbortController: AbortController | null = null;

let provisioningPollingTimer: ReturnType<typeof setInterval> | null = null;
let runtimePollingTimer: ReturnType<typeof setInterval> | null = null;
const listEl = $state<HTMLDivElement | null>(null);
const contentEl = $state<HTMLDivElement | null>(null);
let savingChannelConfigById = $state<Record<string, boolean>>({});
let channelConfigErrorById = $state<Record<string, string>>({});
let loadingSessionIds = $state<Record<string, boolean>>({});
let bootstrapping = $state(true);
let didInitialScrollBySession = $state<Record<string, boolean>>({});
let shouldAutoFollow = $state(true);
let creatingSession = $state(false);
let createSessionError = $state("");
let showSettings = $state(false);

const activeSessionState = $derived(activeSessionId ? sessionStateById[activeSessionId] ?? null : null);

const timeline = $derived.by<TimelineItem[]>(() => {
  const state = activeSessionState;
  if (!state) return [];
  const items: TimelineItem[] = toChatMessages(state.messages).map((message) => ({
    id: message.id,
    kind: "message",
    message,
  }));

  if (streamingToolCalls.length > 0) {
    for (const tc of streamingToolCalls) {
      items.push({
        id: `stream-tool-${tc.toolCallId}`,
        kind: "tool",
        tool: {
          id: tc.toolCallId,
          name: tc.toolName,
          input: {},
          status: tc.status === "running" ? "running" : tc.status === "done" ? "done" : "error",
          output: tc.summary ?? "",
        },
      });
    }
  }

  if (streamingAssistantText.trim() || streamingThinking.trim()) {
    const contentBlocks: Array<
      { type: "thinking"; thinking: string } | { type: "text"; text: string }
    > = [];
    if (streamingThinking.trim()) {
      contentBlocks.push({ type: "thinking", thinking: streamingThinking });
    }
    if (streamingAssistantText.trim()) {
      contentBlocks.push({ type: "text", text: streamingAssistantText });
    }
    items.push({
      id: "assistant-streaming",
      kind: "message",
      message: {
        id: "assistant-streaming",
        role: "assistant",
        content: contentBlocks as never,
        text: streamingAssistantText,
        sequence: (state.messages.at(-1)?.sequence ?? 0) + 1,
      },
    });
  }

  return items;
});

// Sync active session with URL
$effect(() => {
  if (urlSessionId && urlSessionId !== activeSessionId) {
    activeSessionId = urlSessionId;
    shouldAutoFollow = true;
    didInitialScrollBySession = { ...didInitialScrollBySession, [urlSessionId]: false };
  }
});

function updateUrlSession(sessionId: string | null) {
  const params = new URLSearchParams(page.url.searchParams);
  if (sessionId) {
    params.set("session", sessionId);
  } else {
    params.delete("session");
  }
  void goto(`/runtimes/${runtimeId}?${params.toString()}`, { replaceState: true });
}

async function handleCreateNewSession() {
  if (creatingSession || !runtime) return;
  creatingSession = true;
  createSessionError = "";

  try {
    const result = await createRuntimeSession(runtime.id, { source: "web" });
    const newSession = result.session;

    runtimeSessions = [...runtimeSessions, newSession];
    sessionStateById = {
      ...sessionStateById,
      [newSession.id]: {
        session: newSession,
        messages: [],
        loading: false,
        loaded: true,
        error: "",
      },
    };

    activeSessionId = newSession.id;
    updateUrlSession(newSession.id);
  } catch (error) {
    createSessionError = error instanceof Error ? error.message : "Failed to create session";
  } finally {
    creatingSession = false;
  }
}

function seedSessions(sessions: SessionRecord[]) {
  if (sessions.length === 0 && runtimeSessions.length > 0) return;

  runtimeSessions = sessions;
  const nextState = { ...sessionStateById };
  for (const session of sessions) {
    if (!nextState[session.id]) {
      nextState[session.id] = {
        session,
        messages: [],
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

  // Auto-select session from URL or fallback to latest
  if (urlSessionId && !sessionStateById[urlSessionId]?.loaded) {
    // Will be loaded by the effect below
  } else if (!activeSessionId && sessions.length > 0) {
    const nextId = sessions.at(-1)?.id ?? null;
    activeSessionId = nextId;
    updateUrlSession(nextId);
  }
}

function getDiscordRuntimeChannelConfig(runtimeChannel: RuntimeChannelRecord): RuntimeChannelConfigInput {
  return runtimeChannel.config ?? {
    inbound: { requireMentionInGuild: true },
    outbound: { showThinking: false, showToolCalls: false },
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
  if (!(await ensureAuth())) return;
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
    seedSessions(sessionsResult.value.sessions ?? []);
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
      loading: true,
      loaded: existing?.loaded ?? false,
      error: existing?.error ?? "",
    },
  };

  try {
    const response = await getSessionMessages(sessionId);
    sessionStateById = {
      ...sessionStateById,
      [sessionId]: {
        session: response.session,
        messages: response.messages,
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

function shouldPollRuntime(runtime: RuntimeRecord | null) {
  if (!runtime) return true;
  const status = runtime.liveStatus ?? runtime.status;
  if (!status) return true;
  return status === "starting" || status === "hibernating";
}

// ─── SSE streaming ───

function clearStreamingState() {
  streamingAssistantText = "";
  streamingThinking = "";
  streamingToolCalls = [];
}

async function handleSSEEvent(event: RuntimeStreamEvent) {
  if (activeSessionId == null || event.sessionId !== activeSessionId) return;

  if (event.type === "provider_render_update") {
    if (event.thinking != null) streamingThinking = event.thinking;
    if (event.toolCalls != null) streamingToolCalls = event.toolCalls;
    if (event.answer != null) {
      streamingAssistantText = event.answer;
      await tick();
      if (shouldAutoFollow) scrollToBottomNow();
    }

    if (event.turnEnd) {
      clearStreamingState();
      streamStatus = "done";
      await loadSessionState(activeSessionId, true);
    }
  }
}

function startSSE() {
  if (sseAbortController) return;
  sseAbortController = new AbortController();

  (async () => {
    while (!sseAbortController.signal.aborted) {
      try {
        for await (const event of streamRuntimeEvents(
          runtimeId,
          undefined,
          sseAbortController.signal,
        )) {
          void handleSSEEvent(event);
        }
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") break;
        console.error("[SSE] Stream error, reconnecting in 2s:", error);
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
    sseAbortController = null;
  })();
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
    clearStreamingState();

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
              sequence: (currentState.messages.at(-1)?.sequence ?? 0) + 1,
              provider: null,
              model: null,
              stopReason: null,
              errorMessage: null,
              usageInput: null,
              usageOutput: null,
              costTotal: null,
              createdAt: new Date().toISOString(),
            },
          ],
        },
      };
    }

    await postSessionMessage(sessionId, [{ type: "text", text }]);
  } catch (error) {
    streamError = error instanceof Error ? error.message : "Failed to send message";
    streamStatus = "error";
    clearStreamingState();
    await loadSessionState(sessionId, true).catch(() => undefined);
  } finally {
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
    setTimeout(() => scrollToBottomNow(), 0);
  });
}

function runtimeStatusColor(status: string) {
  if (status === "running") return "text-emerald-400";
  if (status === "starting" || status === "active") return "text-amber-400";
  if (status === "error" || status === "boot_failed") return "text-rose-400";
  if (status === "hibernated") return "text-gray-400";
  if (status === "hibernating") return "text-blue-400";
  return "text-text-tertiary";
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

  runtimePollingTimer = setInterval(() => {
    if (!shouldPollRuntime(runtime)) return;
    void loadRuntime();
  }, 1000);

  startSSE();

  return () => {
    if (provisioningPollingTimer) clearInterval(provisioningPollingTimer);
    if (runtimePollingTimer) clearInterval(runtimePollingTimer);
    if (sseAbortController) {
      sseAbortController.abort();
      sseAbortController = null;
    }
  };
});

// Clear streaming state when switching sessions
$effect(() => {
  void activeSessionId;
  clearStreamingState();
});

$effect(() => {
  if (activeSessionId) {
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
  queueMicrotask(() => scrollToBottomNow());
});
</script>

<!-- Runtime Header -->
<header class="h-10 flex items-center justify-between px-3 border-b border-border-primary shrink-0 bg-bg-primary">
  <div class="flex items-center gap-3 min-w-0">
    <Terminal class="w-4 h-4 text-text-tertiary shrink-0" />
    <span class="font-mono text-xs text-text-primary truncate max-w-[320px]">{runtime?.title || runtime?.id || runtimeId}</span>
    <div class="hidden md:flex items-center gap-1.5 ml-2 px-2 py-0.5 rounded bg-hover border border-border-subtle shrink-0">
      <div class="w-1.5 h-1.5 rounded-full bg-current {provisioning && shouldPollProvisioning(provisioning) ? 'text-amber-400' : runtimeStatusColor(runtime?.liveStatus ?? runtime?.status ?? 'unknown')}"></div>
      <span class="text-[10px] uppercase tracking-wider font-medium text-text-secondary">
        {#if provisioning && shouldPollProvisioning(provisioning)}
          {provisioning.currentStep}
        {:else}
          {runtime?.liveStatus ?? runtime?.status ?? "unknown"}
        {/if}
      </span>
    </div>
  </div>

  <div class="flex items-center gap-1.5">
    <button
      type="button"
      class="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs text-text-tertiary hover:text-text-secondary hover:bg-hover transition-colors disabled:opacity-50"
      onclick={() => handleCreateNewSession()}
      disabled={creatingSession || !runtime}
      title="New session"
    >
      {#if creatingSession}
        <div class="w-3 h-3 rounded-full border border-border-primary border-t-emerald-400 animate-spin"></div>
      {:else}
        <Plus class="w-3.5 h-3.5" />
      {/if}
      <span class="hidden sm:inline">New Session</span>
    </button>
    <button
      type="button"
      class="flex items-center justify-center w-7 h-7 rounded-md text-text-tertiary hover:text-text-secondary hover:bg-hover transition-colors"
      onclick={() => showSettings = !showSettings}
      title="Settings"
    >
      <Settings class="w-4 h-4" />
    </button>
  </div>
</header>

<!-- Main Content -->
<div class="flex-1 flex min-h-0">
  <div class="flex-1 flex flex-col min-w-0 bg-bg-content">
    {#if bootstrapping && !activeSessionState}
      <div class="flex-1 flex items-center justify-center bg-bg-content">
        <div class="flex flex-col items-center gap-3 text-text-tertiary">
          <div class="w-8 h-8 rounded-full border-2 border-border-primary border-t-emerald-400 animate-spin"></div>
          <div class="text-xs font-mono">Loading runtime…</div>
        </div>
      </div>
    {:else if !activeSessionState}
      <div class="flex-1 flex flex-col items-center justify-center text-text-tertiary gap-4">
        <div class="text-sm">No session selected</div>
        <button
          type="button"
          class="flex items-center gap-1.5 px-3 py-2 rounded-md bg-hover hover:bg-hover-strong border border-border-primary text-xs text-text-secondary hover:text-text-primary transition-colors disabled:opacity-50"
          onclick={() => handleCreateNewSession()}
          disabled={creatingSession || !runtime}
        >
          <Plus class="w-3.5 h-3.5" />
          Create a session
        </button>
      </div>
    {:else if activeSessionState.loading && !activeSessionState.loaded}
      <div class="flex-1 flex items-center justify-center bg-bg-content">
        <div class="flex flex-col items-center gap-3 text-text-tertiary">
          <div class="w-7 h-7 rounded-full border-2 border-border-subtle border-t-emerald-400 animate-spin"></div>
          <div class="text-xs font-mono">Loading messages…</div>
        </div>
      </div>
    {:else}
      {#if activeSessionState.error}
        <div class="m-4 rounded-md border border-rose-500/20 bg-rose-500/10 p-3 text-xs font-mono text-rose-400 break-all">
          {activeSessionState.error}
        </div>
      {/if}

      <div class="relative flex-1 min-h-0 flex flex-col">
        <ChatTimeline bindListEl={listEl} bindContentEl={contentEl} timeline={timeline} onScrollChange={updateAutoFollow} />

        {#if !shouldAutoFollow && timeline.length > 0}
          <button
            type="button"
            class="absolute bottom-4 right-4 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-hover-strong hover:bg-active border border-border-primary text-xs text-text-secondary hover:text-text-primary transition-all shadow-lg backdrop-blur-sm"
            onclick={() => {
              shouldAutoFollow = true;
              forceScrollToBottom();
            }}
          >
            <ArrowDown class="w-3.5 h-3.5" />
            <span>Scroll to bottom</span>
          </button>
        {/if}
      </div>

      <div class="border-t border-border-primary bg-bg-primary">
        <SessionComposer bind:value={input} disabled={sending || !activeSessionState} streamError={streamError} onsubmit={handleSend} />
      </div>
    {/if}
  </div>

  <!-- Settings Panel -->
  {#if showSettings}
    <div class="flex w-80 flex-col border-l border-border-primary bg-bg-primary shrink-0 overflow-y-auto">
      <div class="h-9 flex items-center justify-between px-3 border-b border-border-subtle text-[11px] font-medium uppercase tracking-wider text-text-tertiary select-none sticky top-0 bg-bg-primary z-10">
        <span>Settings</span>
        <button
          type="button"
          class="flex items-center justify-center w-6 h-6 rounded-sm text-text-tertiary hover:text-text-secondary hover:bg-hover transition-colors"
          onclick={() => showSettings = false}
          title="Close settings"
        >
          <X class="w-3.5 h-3.5" />
        </button>
      </div>

      <div class="p-4 space-y-6">
        <section class="space-y-3">
          <div class="text-[10px] font-bold text-text-tertiary uppercase tracking-widest flex items-center justify-between">
            <span>Channels</span>
            <span class="px-1.5 py-0.5 rounded-sm bg-hover-strong text-text-secondary">{runtimeChannels.length}</span>
          </div>

          {#if runtimeChannels.length === 0}
            <div class="rounded-md border border-border-subtle bg-hover p-3 text-xs text-text-tertiary">No channels bound.</div>
          {:else}
            <div class="space-y-3">
              {#each runtimeChannels as runtimeChannel (runtimeChannel.id)}
                <div class="border border-border-primary rounded-md bg-bg-surface overflow-hidden">
                  <div class="px-3 py-2 border-b border-border-subtle bg-bg-header-alt flex items-center gap-2">
                    <Hash class="w-3 h-3 text-text-tertiary" />
                    <span class="text-xs font-medium text-text-primary truncate">{runtimeChannel.channel?.name || runtimeChannel.channel?.provider}</span>
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
                            <span class="text-xs text-text-secondary group-hover:text-text-primary transition-colors">Require mention in Guild</span>
                            <span class="text-[10px] text-text-placeholder">Respond only when mentioned</span>
                          </div>
                        </label>

                        <div class="w-full h-px bg-border-subtle"></div>

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
                            <span class="text-xs text-text-secondary group-hover:text-text-primary transition-colors">Show thinking</span>
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
                            <span class="text-xs text-text-secondary group-hover:text-text-primary transition-colors">Show tool calls</span>
                          </div>
                        </label>
                      </div>
                    {:else}
                      <div class="text-xs text-text-tertiary">No configuration available.</div>
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
    </div>
  {/if}
</div>
