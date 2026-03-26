<script lang="ts">
import { onMount } from "svelte";
import {
  forkSession,
  getRuntime,
  getRuntimeProvisioning,
  getRuntimeSessions,
  getRuntimeStreamUrl,
  getSessionMessages,
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

const { data: initialData }: Props = $props();

let runtime = $state<RuntimeRecord>(initialData.runtime);
let runtimeSessions = $state<SessionRecord[]>([]);
let sessionStateById = $state<Record<string, SessionViewState>>({});
let activeSessionId = $state<string | null>(initialData.session?.id ?? null);
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

if (initialData.session && initialData.persisted) {
  sessionStateById = {
    [initialData.session.id]: {
      session: initialData.session,
      messages: initialData.persisted.messages,
      toolCalls: initialData.persisted.toolCalls,
      loading: false,
      error: "",
    },
  };
}

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

async function loadRuntime() {
  try {
    runtime = await getRuntime(initialData.runtime.id);
    const sessionsResponse = await getRuntimeSessions(initialData.runtime.id);
    runtimeSessions = sessionsResponse.sessions;

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

  sessionStateById = {
    ...sessionStateById,
    [sessionId]: {
      session: existing?.session ?? runtimeSessions.find((item) => item.id === sessionId)!,
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
        session: existing?.session ?? runtimeSessions.find((item) => item.id === sessionId)!,
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
        if (agentEvent.type === "message_update") {
          const message = agentEvent.message as { content?: Array<{ type?: string; text?: string }> };
          const text = Array.isArray(message?.content)
            ? message.content
                .filter((item) => item?.type === "text" && typeof item.text === "string")
                .map((item) => item.text as string)
                .join("\n")
            : "";
          streamingAssistantText = text;
        }
        if (agentEvent.type === "turn_end" || agentEvent.type === "message_end") {
          streamingAssistantText = "";
          if (activeSessionId) {
            await loadSessionState(activeSessionId, true);
          }
          await loadRuntime();
        }
      }
    } catch {
      // ignore malformed payloads
    }
  };
}

async function handleSend() {
  const sessionId = activeSessionId;
  if (!sessionId || !input.trim()) return;
  sending = true;
  try {
    const text = input;
    input = "";
    const response = await fetch(`/api/sessions/${sessionId}/messages`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!response.ok) {
      throw new Error(await response.text());
    }
    await loadSessionState(sessionId, true);
    await loadRuntime();
  } catch (error) {
    input = input || "";
    alert(error instanceof Error ? error.message : "Failed to send message");
  } finally {
    sending = false;
  }
}

async function handleFork(messageId: string) {
  if (!activeSessionId) return;
  try {
    const response = await forkSession(activeSessionId, { fromMessageId: messageId });
    await loadRuntime();
    activeSessionId = response.session.id;
    await loadSessionState(response.session.id, true);
  } catch (error) {
    alert(error instanceof Error ? error.message : "Failed to fork session");
  }
}


onMount(() => {
  void loadRuntime();
  void loadProvisioning();
  connectStream();
  provisioningPollingTimer = setInterval(() => {
    void loadProvisioning();
    void loadRuntime();
  }, 3000);

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
            <div class="mt-1 text-xs text-gray-500">messages: {session.totalMessages ?? 0} · depth: {session.forkDepth ?? 0}</div>
            {#if session.parentSessionId}
              <div class="mt-1 text-[11px] text-gray-400 break-all">parent: {session.parentSessionId}</div>
            {/if}
          </button>
        {/each}
      {/if}
    </div>
  </aside>

  <section class="flex min-w-0 flex-col bg-[#141414]">
    <div class="border-b border-white/5 px-6 py-4 text-sm text-white/70">
      {#if activeSessionState}
        <div class="flex items-center justify-between gap-4">
          <div>
            <div class="font-medium text-white">{activeSessionState.session.title || activeSessionState.session.latestMessageText || activeSessionState.session.id}</div>
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
  </section>
</div>
