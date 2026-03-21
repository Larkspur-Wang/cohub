<script lang="ts">
import { onMount } from "svelte";
import {
  abortSession,
  getSessionMessages,
  getSessionStreamUrl,
  getSessionTree,
  selectSessionLeaf,
  sendSessionMessage,
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
  type ChatMessage,
  type SessionTreeNodeView,
  type TimelineItem,
} from "$lib/session-tree";

type Props = {
  data: {
    session: SessionRecord;
    persisted: {
      session: SessionRecord;
      messages: SessionMessageRecord[];
      toolCalls: SessionToolCallRecord[];
    };
    tree: {
      session: {
        id: string;
        currentLeafMessageId: string | null;
        rootMessageId: string | null;
        totalBranches: number;
      };
      nodes: SessionMessageRecord[];
    };
  };
};

const { data }: Props = $props();

// Local state synced from data via $effect, then managed independently
let persistedMessages = $state<SessionMessageRecord[]>([]);
let persistedToolCalls = $state<SessionToolCallRecord[]>([]);
let treeNodes = $state<SessionTreeNodeView[]>([]);
let currentLeafMessageId = $state<string | null>(null);

// Sync data to local state when data changes (e.g., navigating to a different session)
$effect(() => {
  persistedMessages = data.persisted.messages ?? [];
  persistedToolCalls = data.persisted.toolCalls ?? [];
  treeNodes = toTreeNodes(data.tree);
  currentLeafMessageId =
    data.tree.session.currentLeafMessageId ?? data.session.currentLeafMessageId ?? null;
});
let branchFromMessageId = $state<string | null>(null);
let listEl = $state<HTMLDivElement | null>(null);
let input = $state("");
let sending = $state(false);
let selectingLeaf = $state(false);
let streamStatus = $state<"connecting" | "open" | "closed" | "error">(
  "connecting",
);
let streamError = $state("");
let eventSource: EventSource | null = null;

const streamUserMessageIds = new Set<string>();
let streamingAssistantText = $state("");
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

async function refreshPersistedData() {
  const [messagesResponse, treeResponse] = await Promise.all([
    getSessionMessages(data.session.id),
    getSessionTree(data.session.id),
  ]);

  persistedMessages = messagesResponse.messages;
  persistedToolCalls = messagesResponse.toolCalls;
  treeNodes = toTreeNodes(treeResponse);
  currentLeafMessageId = treeResponse.session.currentLeafMessageId;
}

async function handleSend() {
  const text = input.trim();
  if (!text || sending) {
    return;
  }

  const pendingText = text;
  input = "";
  sending = true;

  try {
    const result = await sendSessionMessage(data.session.id, {
      text: pendingText,
      branchFromMessageId: branchFromMessageId ?? undefined,
    });

    const userMessage = result?.userMessage as SessionMessageRecord | undefined;
    if (userMessage) {
      persistedMessages = [...persistedMessages, userMessage];
      streamUserMessageIds.add(userMessage.id);
      currentLeafMessageId = userMessage.id;
    }

    branchFromMessageId = null;
    await refreshPersistedData();
    scrollToBottom();
  } catch (error) {
    streamError = error instanceof Error ? error.message : "Unknown error";
  } finally {
    sending = false;
  }
}

async function handleAbort() {
  try {
    await abortSession(data.session.id);
  } catch (error) {
    streamError = error instanceof Error ? error.message : "Unknown error";
  }
}

async function handleSelectLeaf(messageId: string) {
  if (selectingLeaf) return;
  selectingLeaf = true;
  try {
    await selectSessionLeaf(data.session.id, messageId);
    await refreshPersistedData();
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
    void refreshPersistedData();
    return;
  }

  if (type === "error") {
    streamError =
      typeof payload.error === "string"
        ? payload.error
        : "Agent stream error";
  }
}

onMount(() => {
  scrollToBottom();

  eventSource = new EventSource(getSessionStreamUrl(data.session.id), {
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

  return () => {
    streamStatus = "closed";
    eventSource?.close();
    eventSource = null;
  };
});
</script>

<div class="max-w-7xl mx-auto px-6 py-8 h-[calc(100vh-10rem)] flex flex-col gap-6">
  <div class="bg-white border border-gray-100 rounded-3xl p-6 shadow-sm flex items-center justify-between gap-4">
    <div>
      <div class="text-xs uppercase tracking-[0.2em] font-black text-brand">Session</div>
      <h1 class="text-2xl font-black text-gray-800 mt-2">{data.session.title ?? 'Untitled Session'}</h1>
      <div class="mt-2 text-sm text-gray-400 font-mono break-all">{data.session.id}</div>
      <div class="mt-3 flex flex-wrap gap-2 text-xs text-gray-500 font-medium">
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
        class="px-4 py-2 rounded-xl border border-red-200 text-red-600 font-bold hover:bg-red-50 transition-colors cursor-pointer"
      >
        Abort
      </button>
    </div>
  </div>

  <div class="flex-1 min-h-0 grid grid-cols-12 gap-6">
    <div class="col-span-4 min-h-0 bg-white border border-gray-100 rounded-3xl shadow-sm overflow-hidden flex flex-col">
      <div class="px-5 py-4 border-b border-gray-100 flex items-center justify-between gap-3">
        <div>
          <div class="text-xs uppercase tracking-[0.2em] font-black text-brand">Tree</div>
          <div class="text-sm text-gray-500 mt-1">Switch leaf or branch from any historical node.</div>
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
      <SessionTreePanel
        nodes={treeNodes}
        {currentLeafMessageId}
        selectedBranchFromId={branchFromMessageId}
        onSelectLeaf={handleSelectLeaf}
        onBranchFrom={handleBranchFrom}
      />
    </div>

    <div class="col-span-8 min-h-0 bg-white border border-gray-100 rounded-3xl shadow-sm overflow-hidden flex flex-col">
      <div class="px-5 py-4 border-b border-gray-100 flex items-center justify-between gap-3">
        <div>
          <div class="text-xs uppercase tracking-[0.2em] font-black text-brand">Conversation</div>
          <div class="text-sm text-gray-500 mt-1">
            {#if branchFromMessageId}
              New message will branch from selected node.
            {:else}
              Showing persisted path from root to current leaf.
            {/if}
          </div>
        </div>
      </div>

      <ChatTimeline bind:bindListEl={listEl} {timeline} />
      <SessionComposer bind:value={input} {sending} {streamError} onSubmit={() => void handleSend()} />
    </div>
  </div>
</div>
