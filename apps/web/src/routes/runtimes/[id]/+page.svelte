<script lang="ts">
import { onMount } from "svelte";
import {
  abortSession,
  getRuntime,
  getRuntimeProvisioning,
  getRuntimeSessions,
  getRuntimeStreamUrl,
  getSessionMessages,
  getSessionTree,
  selectSessionLeaf,
  sendSessionMessage,
  type RuntimeProvisionResponse,
  type RuntimeRecord,
  type SessionRecord,
  type SessionMessageRecord,
  type SessionToolCallRecord,
} from "$lib/api";
import ChatTimeline from "$lib/components/ChatTimeline.svelte";
import SessionComposer from "$lib/components/SessionComposer.svelte";
import SessionTreePanel from "$lib/components/SessionTreePanel.svelte";
import {
  toChatMessages,
  toTreeNodes,
  type SessionTreeNodeView,
  type TimelineItem,
} from "$lib/session-tree";

type PersistedData = {
  runtime: RuntimeRecord;
  session: SessionRecord;
  messages: SessionMessageRecord[];
  toolCalls: SessionToolCallRecord[];
};

type TreeData = {
  runtime: RuntimeRecord;
  session: {
    id: string;
    currentLeafMessageId: string | null;
    rootMessageId: string | null;
    totalBranches: number;
  };
  nodes: SessionMessageRecord[];
};

type Props = {
  data: {
    runtime: RuntimeRecord;
    session: SessionRecord | null;
    persisted: PersistedData | null;
    tree: TreeData | null;
  };
};

const { data }: Props = $props();

let runtime = $state<RuntimeRecord>({
  id: "",
  userUuid: "",
  workspaceId: null,
  workspaceCommitHash: null,
  agentId: null,
  agentCommitHash: null,
  title: null,
  status: null,
  liveStatus: null,
  currentSessionId: null,
  meta: null,
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
});
let session = $state<SessionRecord | null>(null);
let persistedMessages = $state<SessionMessageRecord[]>([]);
let persistedToolCalls = $state<SessionToolCallRecord[]>([]);
let treeNodes = $state<SessionTreeNodeView[]>([]);
let currentLeafMessageId = $state<string | null>(null);

$effect(() => {
  runtime = data.runtime;
  session = data.session;
  persistedMessages = data.persisted?.messages ?? [];
  persistedToolCalls = data.persisted?.toolCalls ?? [];
  treeNodes = data.tree ? toTreeNodes(data.tree) : [];
  currentLeafMessageId =
    data.tree?.session.currentLeafMessageId ?? data.session?.currentLeafMessageId ?? null;
});

let branchFromMessageId = $state<string | null>(null);
let listEl = $state<HTMLDivElement | null>(null);
let input = $state("");
let sending = $state(false);
let selectingLeaf = $state(false);
let streamStatus = $state<"connecting" | "open" | "closed" | "error">("connecting");
let streamError = $state("");
let runtimeLoadError = $state("");
let provisioning = $state<RuntimeProvisionResponse | null>(null);
let provisioningError = $state("");
let eventSource: EventSource | null = null;
let runtimePollingTimer: ReturnType<typeof setInterval> | null = null;
let provisioningPollingTimer: ReturnType<typeof setInterval> | null = null;
let streamingAssistantText = $state("");

const effectiveRuntimeStatus = $derived(runtime.liveStatus ?? runtime.status ?? "unknown");
const hasSession = $derived(Boolean(session));
const isProvisioningDone = $derived(
  provisioning?.status === "succeeded" || provisioning?.status === "failed",
);
const isRuntimeReady = $derived(effectiveRuntimeStatus === "running" && hasSession);

let timeline = $derived.by<TimelineItem[]>(() => {
  const persisted = toChatMessages(persistedMessages, persistedToolCalls).map(
    (message) => ({
      id: message.id,
      kind: "message" as const,
      message,
    }),
  );

  if (streamingAssistantText.trim()) {
    persisted.push({
      id: "assistant-streaming",
      kind: "message",
      message: {
        id: "assistant-streaming",
        role: "assistant",
        text: streamingAssistantText,
      },
    });
  }

  return persisted;
});

function scrollToBottom() {
  queueMicrotask(() => {
    listEl?.scrollTo({ top: listEl.scrollHeight, behavior: "smooth" });
  });
}

async function refreshRuntimeState() {
  try {
    runtimeLoadError = "";
    const nextRuntime = await getRuntime(runtime.id);
    runtime = nextRuntime;

    const sessionsResponse = await getRuntimeSessions(runtime.id);
    const currentSessionId =
      nextRuntime.currentSessionId ?? sessionsResponse.sessions.at(-1)?.id ?? null;

    if (!currentSessionId) {
      session = null;
      persistedMessages = [];
      persistedToolCalls = [];
      treeNodes = [];
      currentLeafMessageId = null;
      return;
    }

    const [messagesResponse, treeResponse] = await Promise.all([
      getSessionMessages(currentSessionId),
      getSessionTree(currentSessionId),
    ]);

    session = messagesResponse.session;
    persistedMessages = messagesResponse.messages;
    persistedToolCalls = messagesResponse.toolCalls;
    treeNodes = toTreeNodes(treeResponse);
    currentLeafMessageId = treeResponse.session.currentLeafMessageId;
  } catch (error) {
    runtimeLoadError = error instanceof Error ? error.message : "Failed to refresh runtime";
  }
}

async function refreshProvisioningState() {
  try {
    provisioningError = "";
    provisioning = await getRuntimeProvisioning(runtime.id);
  } catch (error) {
    provisioningError = error instanceof Error ? error.message : "Failed to refresh provisioning status";
  }
}

async function handleSend() {
  const text = input.trim();
  if (!text || sending || !session) {
    return;
  }

  const pendingText = text;
  input = "";
  sending = true;

  try {
    const result = await sendSessionMessage(session.id, {
      text: pendingText,
      branchFromMessageId: branchFromMessageId ?? undefined,
    });

    const userMessage = result?.userMessage as SessionMessageRecord | undefined;
    if (userMessage) {
      persistedMessages = [...persistedMessages, userMessage];
      currentLeafMessageId = userMessage.id;
    }

    branchFromMessageId = null;
    await refreshRuntimeState();
    scrollToBottom();
  } catch (error) {
    streamError = error instanceof Error ? error.message : "Unknown error";
  } finally {
    sending = false;
  }
}

async function handleAbort() {
  if (!session) return;
  try {
    await abortSession(session.id);
  } catch (error) {
    streamError = error instanceof Error ? error.message : "Unknown error";
  }
}

async function handleSelectLeaf(messageId: string) {
  if (selectingLeaf || !session) return;
  selectingLeaf = true;
  try {
    await selectSessionLeaf(session.id, messageId);
    await refreshRuntimeState();
    streamStatus = eventSource ? streamStatus : "closed";
    scrollToBottom();
  } catch (error) {
    streamError = error instanceof Error ? error.message : "Failed to switch branch";
  } finally {
    selectingLeaf = false;
  }
}

function handleBranchFrom(messageId: string) {
  branchFromMessageId = branchFromMessageId === messageId ? null : messageId;
}

function handleAgentEvent(payload: Record<string, unknown>) {
  const type = typeof payload.type === "string" ? payload.type : "unknown";

  if (type === "message_start") {
    const message = payload.message as Record<string, unknown> | undefined;
    if (message?.role === "assistant") {
      streamingAssistantText = "";
    }
    return;
  }

  if (type === "message_update") {
    const delta = payload.assistantMessageEvent as Record<string, unknown> | undefined;
    const deltaType = typeof delta?.type === "string" ? delta.type : "";

    if (deltaType === "text_delta") {
      const deltaText = typeof delta?.delta === "string" ? delta.delta : "";
      streamingAssistantText = `${streamingAssistantText}${deltaText}`;
      scrollToBottom();
    }
    return;
  }

  if (type === "turn_end") {
    streamingAssistantText = "";
    void refreshRuntimeState();
    return;
  }

  if (type === "error") {
    streamError =
      typeof payload.error === "string"
        ? payload.error
        : "Runtime stream error";
  }
}

onMount(() => {
  scrollToBottom();

  void Promise.all([refreshRuntimeState(), refreshProvisioningState()]);

  eventSource = new EventSource(getRuntimeStreamUrl(runtime.id), {
    withCredentials: true,
  });

  eventSource.addEventListener("ready", () => {
    streamStatus = "open";
    streamError = "";
  });

  eventSource.addEventListener("message", (event) => {
    try {
      const payload = JSON.parse((event as MessageEvent).data) as Record<string, unknown>;
      handleAgentEvent(payload);
    } catch (error) {
      streamError = error instanceof Error ? error.message : "Invalid event payload";
    }
  });

  eventSource.onerror = () => {
    streamStatus = "error";
    streamError = "Stream disconnected. Browser will retry automatically.";
  };

  runtimePollingTimer = setInterval(() => {
    void refreshRuntimeState();
  }, 2000);

  provisioningPollingTimer = setInterval(() => {
    if (!isProvisioningDone) {
      void refreshProvisioningState();
      return;
    }

    if (provisioningPollingTimer) {
      clearInterval(provisioningPollingTimer);
      provisioningPollingTimer = null;
    }
  }, 1000);

  return () => {
    streamStatus = "closed";
    eventSource?.close();
    eventSource = null;
    if (runtimePollingTimer) clearInterval(runtimePollingTimer);
    if (provisioningPollingTimer) clearInterval(provisioningPollingTimer);
    runtimePollingTimer = null;
    provisioningPollingTimer = null;
  };
});
</script>

<div class="max-w-7xl mx-auto px-6 py-8 h-[calc(100vh-10rem)] flex flex-col gap-6">
  <div class="bg-white border border-gray-100 rounded-3xl p-6 shadow-sm flex items-center justify-between gap-4">
    <div>
      <div class="text-xs uppercase tracking-[0.2em] font-black text-brand">Runtime</div>
      <h1 class="text-2xl font-black text-gray-800 mt-2">{runtime.title ?? 'Untitled Runtime'}</h1>
      <div class="mt-2 text-sm text-gray-400 font-mono break-all">runtime: {runtime.id}</div>
      <div class="mt-2 text-sm text-gray-400 font-mono break-all">workspace: {runtime.workspaceId ?? 'unbound'}</div>
      <div class="mt-2 text-sm text-gray-400 font-mono break-all">current session: {runtime.currentSessionId ?? 'none'}</div>
      {#if session}
        <div class="mt-2 text-sm text-gray-400 font-mono break-all">session: {session.id}</div>
      {/if}
      <div class="mt-3 flex flex-wrap gap-2 text-xs text-gray-500 font-medium">
        <span class="px-2 py-1 rounded-full bg-gray-100">status: {effectiveRuntimeStatus}</span>
        {#if session}
          <span class="px-2 py-1 rounded-full bg-gray-100">protocol: {session.protocol ?? 'unknown'}</span>
        {/if}
        <span class="px-2 py-1 rounded-full bg-gray-100">{persistedMessages.length} messages</span>
        <span class="px-2 py-1 rounded-full bg-gray-100">{persistedToolCalls.length} tools</span>
        <span class="px-2 py-1 rounded-full bg-gray-100">{treeNodes.filter((node) => node.childCount > 1).length} branch points</span>
      </div>
    </div>

    <div class="flex items-center gap-3">
      <div class="px-3 py-2 rounded-full text-xs font-bold uppercase tracking-widest {streamStatus === 'open' ? 'bg-green-50 text-green-700' : streamStatus === 'connecting' ? 'bg-yellow-50 text-yellow-700' : streamStatus === 'error' ? 'bg-red-50 text-red-700' : 'bg-gray-100 text-gray-500'}">
        {streamStatus}
      </div>
      <button
        onclick={handleAbort}
        disabled={!session}
        class="px-4 py-2 rounded-xl border border-red-200 text-red-600 font-bold hover:bg-red-50 transition-colors cursor-pointer disabled:opacity-50"
      >
        Abort session
      </button>
    </div>
  </div>

  {#if runtimeLoadError}
    <div class="bg-red-50 border border-red-200 text-red-700 p-4 rounded-2xl text-sm break-all">
      {runtimeLoadError}
    </div>
  {/if}

  {#if provisioningError}
    <div class="bg-red-50 border border-red-200 text-red-700 p-4 rounded-2xl text-sm break-all">
      {provisioningError}
    </div>
  {/if}

  {#if !isRuntimeReady}
    <div class="bg-white border border-gray-100 rounded-3xl p-8 shadow-sm space-y-5">
      <div>
        <div class="text-xs uppercase tracking-[0.2em] font-black text-brand">Starting</div>
        <h2 class="mt-2 text-xl font-semibold text-gray-900">Runtime is being prepared</h2>
        <p class="mt-2 text-sm text-gray-500">
          The runtime has been created and this page is polling startup progress every 1 second. You can stay here while the sandbox finishes startup.
        </p>
      </div>

      <div class="flex flex-wrap gap-2 text-xs text-gray-500 font-medium">
        <span class="px-2 py-1 rounded-full bg-gray-100">runtime status: {effectiveRuntimeStatus}</span>
        <span class="px-2 py-1 rounded-full bg-gray-100">session ready: {session ? 'yes' : 'no'}</span>
        <span class="px-2 py-1 rounded-full {provisioning?.status === 'failed' ? 'bg-red-50 text-red-700' : provisioning?.status === 'succeeded' ? 'bg-green-50 text-green-700' : 'bg-yellow-50 text-yellow-700'}">
          provisioning: {provisioning?.status ?? 'queued'}
        </span>
        {#if provisioning?.currentStep}
          <span class="px-2 py-1 rounded-full bg-gray-100">step: {provisioning.currentStep}</span>
        {/if}
      </div>

      {#if provisioning}
        <div class="rounded-2xl border border-gray-100 overflow-hidden">
          <div class="px-4 py-3 border-b border-gray-100 bg-gray-50">
            <div class="text-sm font-semibold text-gray-900">Startup progress</div>
            <div class="mt-1 text-xs text-gray-500 break-all">
              {provisioning.currentMessage ?? 'Waiting for provisioning updates...'}
            </div>
            {#if provisioning.error}
              <div class="mt-2 text-xs text-red-600 break-all">{provisioning.error}</div>
            {/if}
          </div>

          <div class="divide-y divide-gray-100">
            {#each provisioning.events as event}
              <div class="px-4 py-3 flex items-start gap-3">
                <div class="mt-0.5 h-2.5 w-2.5 rounded-full {event.level === 'error' ? 'bg-red-500' : event.level === 'success' ? 'bg-green-500' : 'bg-yellow-500'}"></div>
                <div class="min-w-0 flex-1">
                  <div class="flex items-center gap-2 flex-wrap">
                    <span class="text-sm font-medium text-gray-900">{event.message}</span>
                    <span class="px-2 py-0.5 rounded-full bg-gray-100 text-[11px] text-gray-600">{event.step}</span>
                    <span class="px-2 py-0.5 rounded-full text-[11px] {event.level === 'error' ? 'bg-red-50 text-red-700' : event.level === 'success' ? 'bg-green-50 text-green-700' : 'bg-yellow-50 text-yellow-700'}">{event.level}</span>
                  </div>
                  <div class="mt-1 text-xs text-gray-400">{new Date(event.at).toLocaleTimeString()}</div>
                </div>
              </div>
            {/each}
          </div>
        </div>
      {/if}
    </div>
  {/if}

  <div class={`flex-1 min-h-0 grid grid-cols-12 gap-6 ${isRuntimeReady ? "opacity-100" : "opacity-60"}`}>
    <div class="col-span-4 min-h-0 bg-white border border-gray-100 rounded-3xl shadow-sm overflow-hidden flex flex-col">
      <div class="px-5 py-4 border-b border-gray-100 flex items-center justify-between gap-3">
        <div>
          <div class="text-xs uppercase tracking-[0.2em] font-black text-brand">Session tree</div>
          <div class="text-sm text-gray-500 mt-1">Switch leaf or branch from any historical node inside the current session.</div>
        </div>
        {#if branchFromMessageId}
          <button
            type="button"
            class="px-3 py-2 rounded-xl text-xs font-bold border border-brand/20 text-brand hover:bg-brand/5 cursor-pointer"
            onclick={() => (branchFromMessageId = null)}
          >
            Clear branch target
          </button>
        {/if}
      </div>
      {#if session}
        <SessionTreePanel
          nodes={treeNodes}
          {currentLeafMessageId}
          selectedBranchFromId={branchFromMessageId}
          onSelectLeaf={handleSelectLeaf}
          onBranchFrom={handleBranchFrom}
        />
      {:else}
        <div class="p-5 text-sm text-gray-500">No session is available yet.</div>
      {/if}
    </div>

    <div class="col-span-8 min-h-0 bg-white border border-gray-100 rounded-3xl shadow-sm overflow-hidden flex flex-col">
      <div class="px-5 py-4 border-b border-gray-100 flex items-center justify-between gap-3">
        <div>
          <div class="text-xs uppercase tracking-[0.2em] font-black text-brand">Current session</div>
          <div class="text-sm text-gray-500 mt-1">
            {#if !session}
              Waiting for current session to become available.
            {:else if branchFromMessageId}
              New message will branch from selected node.
            {:else}
              Showing persisted path from root to current leaf.
            {/if}
          </div>
        </div>
      </div>

      <ChatTimeline bind:bindListEl={listEl} {timeline} />
      <SessionComposer bind:value={input} sending={sending || !session || !isRuntimeReady} {streamError} onSubmit={() => void handleSend()} />
    </div>
  </div>
</div>
