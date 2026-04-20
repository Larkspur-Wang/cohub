import { createHash } from "node:crypto";
import type {
  PersistMessageInput,
  RegisterSessionInput,
  ContentBlock,
} from "@cohub/protocol";
import { env } from "./env.js";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const INTERNAL_API_BASE_URL =
  env.ENV === "prod"
    ? "http://cohub-api.cohub.svc.cluster.local:8787"
    : "http://cohub-api-dev.cohub-dev.svc.cluster.local:8787";


const internalHeaders = () => ({
  "content-type": "application/json",
  ...(env.WORKER_SECRET ? { "x-worker-secret": env.WORKER_SECRET } : {}),
});

// ─── Idempotency ───

const stableSerialize = (value: unknown): string => {
  if (value === null || value === undefined) return JSON.stringify(value);
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item)).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
  return `{${entries
    .map(([key, nestedValue]) => `${JSON.stringify(key)}:${stableSerialize(nestedValue)}`)
    .join(",")}}`;
};

const buildAssistantIdempotencyKey = (input: {
  previousMessageId: string;
  message: PersistMessageInput["message"];
}): string => {
  return createHash("sha256")
    .update(
      stableSerialize({
        previousMessageId: input.previousMessageId,
        role: "assistant",
        message: input.message,
      }),
    )
    .digest("hex");
};

const buildUserIdempotencyKey = (input: {
  messageId: string;
  content: ContentBlock[];
  meta?: Record<string, unknown> | null;
}): string => {
  return createHash("sha256")
    .update(
      stableSerialize({
        role: "user",
        messageId: input.messageId,
        content: input.content,
        meta: input.meta ?? null,
      }),
    )
    .digest("hex");
};

async function postJsonWithRetry(input: {
  url: string;
  body: unknown;
  errorPrefix: string;
  maxAttempts?: number;
}) {
  const maxAttempts = input.maxAttempts ?? 3;
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await fetch(input.url, {
        method: "POST",
        headers: internalHeaders(),
        body: JSON.stringify(input.body),
      });

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        // Retry on 5xx server errors (transient — e.g. DB race on previousMessageId)
        if (response.status >= 500 && attempt < maxAttempts) {
          await sleep(500 * attempt);
          continue;
        }
        throw new Error(`${input.errorPrefix} ${response.status}: ${text}`);
      }

      return response.json().catch(() => null);
    } catch (error) {
      lastError = error;
      if (attempt < maxAttempts) {
        await sleep(500 * attempt);
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

// ─── Content extraction ───

const extractTextFromContent = (content: unknown): string => {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  const result: string[] = [];
  for (const item of content) {
    if (!item || typeof item !== "object" || !("type" in item)) continue;
    const block = item as Record<string, unknown>;
    const t = block.type;
    if (t === "text" && typeof block.text === "string") result.push(block.text);
    else if (t === "thinking" && typeof block.thinking === "string") result.push(block.thinking);
    else if (t === "resource" && block.resource && typeof (block.resource as Record<string, unknown>).text === "string") result.push((block.resource as Record<string, unknown>).text as string);
    else if (t === "tool_result" && typeof block.content === "string") result.push(block.content);
    else if (t === "resource_link") result.push(String(block.title || block.name || block.uri || ""));
  }
  return result.join("\n").trim();
};

const extractThinkingFromContent = (content: unknown): string => {
  if (!Array.isArray(content)) return "";
  return content
    .filter((item): item is { type: string; thinking?: string } =>
      !!item && typeof item === "object" && "type" in item && item.type === "thinking" && typeof item.thinking === "string")
    .map((item) => item.thinking ?? "")
    .join("\n")
    .trim();
};

const summarizeThinking = (thinking: string): string => {
  const trimmed = thinking.trim();
  if (!trimmed) return "";
  const lines = trimmed.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  return lines.slice(0, 3).join("\n").slice(0, 600);
};

const summarizeToolArgs = (toolName: string, args: unknown): string => {
  if (!args || typeof args !== "object") return "";
  const record = args as Record<string, unknown>;
  if (toolName === "bash" && typeof record.command === "string") return record.command.trim().slice(0, 120);
  if (typeof record.path === "string") return record.path;
  if (typeof record.pattern === "string" && typeof record.path === "string") return `${record.pattern} in ${record.path}`;
  if (typeof record.query === "string") return record.query;
  const first = Object.entries(record)
    .filter(([, value]) => typeof value === "string" || typeof value === "number" || typeof value === "boolean")
    .slice(0, 2)
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(" ");
  return first.slice(0, 120);
};

// ─── Event → ContentBlock conversion ───

function eventToContentBlocks(assistantMessage: Record<string, unknown>, toolResults: Array<Record<string, unknown>>): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  const content = Array.isArray(assistantMessage.content) ? assistantMessage.content : [];
  const toolResultsById = new Map(toolResults.map((r) => [String(r.toolCallId ?? ""), r]));

  for (const item of content) {
    if (!item || typeof item !== "object") continue;
    const block = item as Record<string, unknown>;

    if (block.type === "text" && typeof block.text === "string") {
      blocks.push({ type: "text", text: block.text });
      continue;
    }
    if (block.type === "thinking" && typeof block.thinking === "string") {
      blocks.push({ type: "thinking", thinking: block.thinking });
      continue;
    }
    if (block.type === "image") {
      blocks.push({
        type: "image",
        source: typeof block.uri === "string"
          ? { type: "url", url: block.uri }
          : typeof block.data === "string"
            ? { type: "base64", media_type: typeof block.mimeType === "string" ? block.mimeType : "application/octet-stream", data: block.data }
            : { type: "url", url: "" },
      });
      continue;
    }
    if (block.type === "toolCall" && typeof block.id === "string" && typeof block.name === "string") {
      blocks.push({
        type: "tool_use",
        id: block.id,
        name: block.name,
        input: (block.arguments as Record<string, unknown>) ?? {},
      });

      // Emit corresponding tool_result
      const result = toolResultsById.get(block.id);
      const resultText = result ? extractTextFromContent(result.content) : "";
      blocks.push({
        type: "tool_result",
        tool_use_id: block.id,
        content: resultText || JSON.stringify(result?.content ?? null),
        is_error: result ? Boolean(result.isError) : false,
      });
    }
  }

  return blocks;
}

// ─── API calls ───

export async function registerSpaceSession(input: RegisterSessionInput) {
  const url = `${INTERNAL_API_BASE_URL}/internal/spaces/${input.spaceId}/sessions`;
  const response = await fetch(url, {
    method: "POST",
    headers: internalHeaders(),
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Register session failed ${response.status}: ${text}`);
  }

  return response.json().catch(() => null) as Promise<{
    ok: true;
    session: { id: string };
    bootstrap?: {
      forkSourceProtocolMessageId: string | null;
    } | null;
  } | null>;
}

export async function getSpaceSandbox(input: { spaceId: string }) {
  const url = `${INTERNAL_API_BASE_URL}/internal/spaces/${input.spaceId}/sandbox`;
  const response = await fetch(url, {
    method: "GET",
    headers: internalHeaders(),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Get space sandbox failed ${response.status}: ${text}`);
  }

  return response.json().catch(() => null) as Promise<{
    sandbox: {
      status: string;
      podName?: string | null;
      meta?: Record<string, unknown> | null;
    } | null;
  } | null>;
}

export async function persistUserMessage(input: {
  spaceId: string;
  sessionId: string;
  userMessageId: string;
  content: ContentBlock[];
  meta?: Record<string, unknown> | null;
}) {
  const payload: PersistMessageInput = {
    spaceId: input.spaceId,
    sessionId: input.sessionId,
    previousMessageId: null,
    anchorUserMessageId: input.userMessageId,
    idempotencyKey: buildUserIdempotencyKey({
      messageId: input.userMessageId,
      content: input.content,
      meta: input.meta ?? null,
    }),
    message: {
      role: "user",
      content: input.content,
      meta: {
        ...(input.meta ?? {}),
        messageId: input.userMessageId,
        clientMessageId: typeof input.meta?.clientMessageId === "string" ? input.meta.clientMessageId : null,
      },
      provider: null,
      model: null,
      stopReason: null,
      errorMessage: null,
      usage: null,
    },
  };

  const url = `${INTERNAL_API_BASE_URL}/internal/spaces/${input.spaceId}/sessions/${input.sessionId}/messages`;
  return postJsonWithRetry({
    url,
    body: {
      previousMessageId: payload.previousMessageId,
      anchorUserMessageId: payload.anchorUserMessageId,
      idempotencyKey: payload.idempotencyKey,
      message: {
        ...payload.message,
        id: input.userMessageId,
      },
    },
    errorPrefix: "Persist user message failed",
  });
}

export async function persistAssistantMessage(input: {
  spaceId: string;
  spaceSessionId: string;
  userMessageId: string;
  event: Record<string, unknown>;
}) {
  const assistantMessage = input.event.message;
  const toolResultsRaw = Array.isArray(input.event.toolResults)
    ? (input.event.toolResults as Array<Record<string, unknown>>)
    : [];

  if (!assistantMessage || typeof assistantMessage !== "object") {
    console.warn("[Persist] turn_end event missing assistant message payload.");
    return;
  }

  const assistant = assistantMessage as Record<string, unknown>;
  const content = eventToContentBlocks(assistant, toolResultsRaw);
  const thinking = extractThinkingFromContent(assistant.content);

  if (content.length === 0) {
    console.warn("[Persist] skipping empty assistant message", {
      spaceId: input.spaceId,
      spaceSessionId: input.spaceSessionId,
      userMessageId: input.userMessageId,
      stopReason: typeof assistant.stopReason === "string" ? assistant.stopReason : null,
    });
    return;
  }

  // Build tool call render states for meta (live rendering)
  const toolResultsById = new Map(toolResultsRaw.map((r) => [String(r.toolCallId ?? ""), r]));
  const toolCallRenderStates = content
    .filter((b) => b.type === "tool_use")
    .map((block) => {
      const toolBlock = block as Extract<typeof block, { type: "tool_use" }>;
      const matched = toolResultsById.get(toolBlock.id);
      return {
        toolCallId: toolBlock.id,
        toolName: toolBlock.name,
        status: matched ? (matched.isError ? "failed" : "done") : "running",
        summary: summarizeToolArgs(toolBlock.name, toolBlock.input),
      };
    });

  const payload: PersistMessageInput = {
    spaceId: input.spaceId,
    sessionId: input.spaceSessionId,
    previousMessageId: input.userMessageId,
    anchorUserMessageId: input.userMessageId,
    idempotencyKey: "",
    message: {
      role: "assistant",
      externalMessageId: typeof assistant.id === "string" ? assistant.id : null,
      protocolMessageId: typeof assistant.id === "string" ? assistant.id : null,
      content,
      provider: typeof assistant.provider === "string" ? assistant.provider : null,
      model: typeof assistant.model === "string" ? assistant.model : null,
      stopReason: typeof assistant.stopReason === "string" ? assistant.stopReason : null,
      errorMessage: typeof assistant.errorMessage === "string" ? assistant.errorMessage : null,
      meta: {
        spaceId: input.spaceId,
        sessionId: input.spaceSessionId,
        rawStopReason: typeof assistant.stopReason === "string" ? assistant.stopReason : null,
        thinking,
        thinkingSummary: summarizeThinking(thinking),
        toolCallRenderStates,
      },
      usage:
        assistant.usage && typeof assistant.usage === "object"
          ? {
              input:
                typeof (assistant.usage as Record<string, unknown>).input === "number"
                  ? ((assistant.usage as Record<string, unknown>).input as number)
                  : undefined,
              output:
                typeof (assistant.usage as Record<string, unknown>).output === "number"
                  ? ((assistant.usage as Record<string, unknown>).output as number)
                  : undefined,
              costTotal:
                assistant.usage &&
                typeof (assistant.usage as Record<string, unknown>).cost === "object" &&
                typeof (((assistant.usage as Record<string, unknown>).cost as Record<string, unknown>).total) === "number"
                  ? (((assistant.usage as Record<string, unknown>).cost as Record<string, unknown>).total as number)
                  : undefined,
            }
          : null,
    },
  };

  payload.idempotencyKey = buildAssistantIdempotencyKey({
    previousMessageId: payload.previousMessageId ?? "root",
    message: payload.message,
  });

  const url = `${INTERNAL_API_BASE_URL}/internal/spaces/${input.spaceId}/sessions/${input.spaceSessionId}/messages`;
  await postJsonWithRetry({
    url,
    body: payload,
    errorPrefix: "Persist API responded",
  });
}
