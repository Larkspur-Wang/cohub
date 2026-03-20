<script lang="ts">
import { onMount } from "svelte";
import {
  abortSession,
  getSessionStreamUrl,
  sendSessionMessage,
  type SessionRecord,
} from "$lib/api";
import ChatTimeline from "$lib/components/ChatTimeline.svelte";
import SessionComposer from "$lib/components/SessionComposer.svelte";
import {
  extractTextContent,
  renderToolPreview,
  stringifyUnknown,
  type SessionEventPayload,
  type TimelineItem,
  type ChatMessage,
  type ToolState,
} from "$lib/session-chat";

type Props = {
  data: {
    session: SessionRecord;
  };
};

const { data }: Props = $props();

let timeline = $state<TimelineItem[]>([
  {
    id: crypto.randomUUID(),
    kind: "message",
    message: {
      id: crypto.randomUUID(),
      role: "system",
      text: "Session connected. Waiting for agent output.",
    },
  },
]);
let input = $state("");
let sending = $state(false);
let streamStatus = $state<"connecting" | "open" | "closed" | "error">(
  "connecting",
);
let streamError = $state("");
let eventSource: EventSource | null = null;
let listEl = $state<HTMLDivElement | null>(null);

const assistantStreamingId = "assistant-streaming";
const thinkingStreamingId = "assistant-thinking";

function scrollToBottom() {
  queueMicrotask(() => {
    listEl?.scrollTo({ top: listEl.scrollHeight, behavior: "smooth" });
  });
}

function upsertMessage(message: ChatMessage) {
  const index = timeline.findIndex(
    (item) => item.kind === "message" && item.message.id === message.id,
  );

  if (index >= 0) {
    timeline[index] = {
      id: timeline[index].id,
      kind: "message",
      message,
    };
    timeline = [...timeline];
  } else {
    timeline = [
      ...timeline,
      {
        id: crypto.randomUUID(),
        kind: "message",
        message,
      },
    ];
  }

  scrollToBottom();
}

function appendMessage(message: Omit<ChatMessage, "id"> & { id?: string }) {
  timeline = [
    ...timeline,
    {
      id: crypto.randomUUID(),
      kind: "message",
      message: {
        id: message.id ?? crypto.randomUUID(),
        ...message,
      },
    },
  ];
  scrollToBottom();
}

function upsertTool(tool: ToolState) {
  const index = timeline.findIndex(
    (item) => item.kind === "tool" && item.tool.id === tool.id,
  );

  if (index >= 0) {
    timeline[index] = {
      id: timeline[index].id,
      kind: "tool",
      tool,
    };
    timeline = [...timeline];
  } else {
    timeline = [
      ...timeline,
      {
        id: crypto.randomUUID(),
        kind: "tool",
        tool,
      },
    ];
  }

  scrollToBottom();
}

function finalizeStreamingMessage(id: string, fallback?: ChatMessage) {
  const index = timeline.findIndex(
    (item) => item.kind === "message" && item.message.id === id,
  );

  if (index < 0) {
    if (fallback?.text.trim()) {
      appendMessage(fallback);
    }
    return;
  }

  const item = timeline[index];
  if (item.kind !== "message") {
    return;
  }

  const finalText = item.message.text.trim() || fallback?.text?.trim() || "";
  if (!finalText) {
    timeline.splice(index, 1);
    timeline = [...timeline];
    return;
  }

  timeline[index] = {
    id: item.id,
    kind: "message",
    message: {
      ...(fallback ?? item.message),
      id: crypto.randomUUID(),
      text: finalText,
    },
  };
  timeline = [...timeline];
}

function handleAgentEvent(payload: SessionEventPayload) {
  const type = typeof payload.type === "string" ? payload.type : "unknown";

  if (type === "message_start") {
    const message = payload.message as Record<string, unknown> | undefined;
    if (message?.role === "assistant") {
      upsertMessage({
        id: assistantStreamingId,
        role: "assistant",
        text: "",
      });
    }
    return;
  }

  if (type === "message_update") {
    const delta = payload.assistantMessageEvent as
      | Record<string, unknown>
      | undefined;
    const deltaType = typeof delta?.type === "string" ? delta.type : "";

    if (deltaType === "text_delta") {
      const current = timeline.find(
        (item) =>
          item.kind === "message" && item.message.id === assistantStreamingId,
      );
      const deltaText = typeof delta?.delta === "string" ? delta.delta : "";
      const nextText = `${current?.kind === "message" ? current.message.text : ""}${deltaText}`;
      upsertMessage({
        id: assistantStreamingId,
        role: "assistant",
        text: nextText,
      });
      return;
    }

    if (deltaType === "thinking_delta") {
      const current = timeline.find(
        (item) =>
          item.kind === "message" && item.message.id === thinkingStreamingId,
      );
      const deltaText = typeof delta?.delta === "string" ? delta.delta : "";
      const nextText = `${current?.kind === "message" ? current.message.text : ""}${deltaText}`;
      upsertMessage({
        id: thinkingStreamingId,
        role: "system",
        title: "Thinking",
        tone: "thinking",
        text: nextText,
      });
      return;
    }

    return;
  }

  if (type === "message_end") {
    const message = payload.message as Record<string, unknown> | undefined;
    const content = Array.isArray(message?.content) ? message.content : [];
    const assistantText = content
      .filter((item) => item?.type === "text" && typeof item.text === "string")
      .map((item) => item.text)
      .join("");
    const thinkingText = content
      .filter(
        (item) =>
          item?.type === "thinking" && typeof item.thinking === "string",
      )
      .map((item) => item.thinking)
      .join("");

    finalizeStreamingMessage(
      thinkingStreamingId,
      thinkingText
        ? {
            id: thinkingStreamingId,
            role: "system",
            title: "Thinking",
            tone: "thinking",
            text: thinkingText,
          }
        : undefined,
    );

    finalizeStreamingMessage(
      assistantStreamingId,
      assistantText
        ? {
            id: assistantStreamingId,
            role: "assistant",
            text: assistantText,
          }
        : undefined,
    );

    const stopReason =
      typeof message?.stopReason === "string" ? message.stopReason : null;
    const errorMessage =
      typeof message?.errorMessage === "string" ? message.errorMessage : null;

    if (stopReason === "error" && errorMessage) {
      appendMessage({
        role: "error",
        title: "Agent Error",
        text: errorMessage,
      });
    }

    if (stopReason === "aborted") {
      appendMessage({
        role: "system",
        title: "Aborted",
        text: "Agent stopped the current response.",
      });
    }

    return;
  }

  if (type === "tool_execution_start") {
    const toolCallId =
      typeof payload.toolCallId === "string"
        ? payload.toolCallId
        : crypto.randomUUID();
    const toolName =
      typeof payload.toolName === "string" ? payload.toolName : "tool";
    const args = (payload.args as Record<string, unknown> | undefined) ?? {};

    upsertTool({
      id: toolCallId,
      name: toolName,
      args,
      status: "running",
      output: renderToolPreview(toolName, args),
    });
    return;
  }

  if (type === "tool_execution_update") {
    const toolCallId =
      typeof payload.toolCallId === "string"
        ? payload.toolCallId
        : crypto.randomUUID();
    const toolName =
      typeof payload.toolName === "string" ? payload.toolName : "tool";
    const args = (payload.args as Record<string, unknown> | undefined) ?? {};
    const partialResult = payload.partialResult;
    const output =
      extractTextContent(partialResult) || renderToolPreview(toolName, args);

    upsertTool({
      id: toolCallId,
      name: toolName,
      args,
      status: "running",
      output,
    });
    return;
  }

  if (type === "tool_execution_end") {
    const toolCallId =
      typeof payload.toolCallId === "string"
        ? payload.toolCallId
        : crypto.randomUUID();
    const toolName =
      typeof payload.toolName === "string" ? payload.toolName : "tool";
    const args = (payload.args as Record<string, unknown> | undefined) ?? {};
    const isError = payload.isError === true;
    const result = payload.result;
    const output =
      extractTextContent(result) || renderToolPreview(toolName, args);

    upsertTool({
      id: toolCallId,
      name: toolName,
      args,
      status: isError ? "error" : "done",
      output,
    });
    return;
  }

  if (type === "agent_start") {
    appendMessage({
      role: "system",
      title: "Agent",
      text: "Agent started working on your request.",
    });
    return;
  }

  if (type === "agent_end") {
    appendMessage({
      role: "system",
      title: "Agent",
      text: "Agent finished this turn.",
    });
    return;
  }

  if (type === "error") {
    appendMessage({
      role: "error",
      title: "Error",
      text:
        typeof payload.error === "string"
          ? payload.error
          : stringifyUnknown(payload),
    });
    return;
  }

  appendMessage({
    role: "system",
    title: type,
    text: stringifyUnknown(payload),
  });
}

async function handleSend() {
  const text = input.trim();
  if (!text || sending) {
    return;
  }

  appendMessage({
    role: "user",
    text,
  });

  input = "";
  sending = true;

  try {
    await sendSessionMessage(data.session.id, { text });
  } catch (error) {
    appendMessage({
      role: "error",
      title: "Send Failed",
      text: error instanceof Error ? error.message : "Unknown error",
    });
  } finally {
    sending = false;
  }
}

async function handleAbort() {
  try {
    await abortSession(data.session.id);
    appendMessage({
      role: "system",
      title: "Abort",
      text: "Abort signal sent.",
    });
  } catch (error) {
    appendMessage({
      role: "error",
      title: "Abort Failed",
      text: error instanceof Error ? error.message : "Unknown error",
    });
  }
}

onMount(() => {
  eventSource = new EventSource(getSessionStreamUrl(data.session.id), {
    withCredentials: true,
  });

  eventSource.addEventListener("ready", () => {
    streamStatus = "open";
    streamError = "";
  });

  eventSource.addEventListener("message", (event) => {
    try {
      const payload = JSON.parse(
        (event as MessageEvent).data,
      ) as SessionEventPayload;
      handleAgentEvent(payload);
    } catch (error) {
      appendMessage({
        role: "error",
        title: "Parse Error",
        text: error instanceof Error ? error.message : "Invalid event payload",
      });
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

<div class="max-w-6xl mx-auto px-6 py-8 h-[calc(100vh-10rem)] flex flex-col gap-6">
  <div class="bg-white border border-gray-100 rounded-3xl p-6 shadow-sm flex items-center justify-between gap-4">
    <div>
      <div class="text-xs uppercase tracking-[0.2em] font-black text-brand">Session</div>
      <h1 class="text-2xl font-black text-gray-800 mt-2">{data.session.title ?? 'Untitled Session'}</h1>
      <div class="mt-2 text-sm text-gray-400 font-mono break-all">{data.session.id}</div>
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

  <div class="flex-1 min-h-0 bg-white border border-gray-100 rounded-3xl shadow-sm overflow-hidden flex flex-col">
    <ChatTimeline bind:bindListEl={listEl} {timeline} />
    <SessionComposer bind:value={input} {sending} {streamError} onSubmit={() => void handleSend()} />
  </div>
</div>
