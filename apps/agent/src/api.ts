import { createHash } from "node:crypto";
import type {
  PersistMessageInput,
  RegisterRuntimeSessionInput,
  UnifiedContentBlock,
} from "@cohub/protocol";
import { env } from "./env.js";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const INTERNAL_API_BASE_URL =
  env.ENV === "prod"
    ? "http://cohub-api.cohub.svc.cluster.local:8787"
    : "http://cohub-api-dev.cohub-dev.svc.cluster.local:8787";

type PersistMessagePayload = PersistMessageInput;

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
  message: PersistMessagePayload["message"];
  toolCalls: PersistMessagePayload["toolCalls"];
}) => {
  return createHash("sha256")
    .update(
      stableSerialize({
        previousMessageId: input.previousMessageId,
        role: "assistant",
        message: input.message,
        toolCalls: input.toolCalls,
      }),
    )
    .digest("hex");
};

const extractTextFromContent = (content: unknown): string => {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  return content
    .filter(
      (
        item,
      ): item is {
        type: string;
        text?: string;
        resource?: { text?: string };
        name?: string;
        uri?: string;
        title?: string;
      } => !!item && typeof item === "object" && "type" in item,
    )
    .flatMap((item) => {
      if (item.type === "text" && typeof item.text === "string") return [item.text];
      if (item.type === "resource" && item.resource && typeof item.resource.text === "string") {
        return [item.resource.text];
      }
      if (item.type === "resource_link") return [item.title || item.name || item.uri || ""];
      return [];
    })
    .join("\n")
    .trim();
};

const extractThinkingFromContent = (content: unknown): string => {
  if (!Array.isArray(content)) return "";

  return content
    .filter(
      (item): item is { type: string; thinking?: string } =>
        !!item && typeof item === "object" && "type" in item,
    )
    .filter((item) => item.type === "thinking" && typeof item.thinking === "string")
    .map((item) => item.thinking ?? "")
    .join("\n")
    .trim();
};

const toAcpCompatibleContent = (
  assistantMessage: Record<string, unknown>,
  toolResults: Array<Record<string, unknown>>,
): UnifiedContentBlock[] => {
  const content = assistantMessage.content;
  const blocks: PersistMessagePayload["message"]["content"] = [];

  if (!Array.isArray(content)) return blocks;

  const toolResultsById = new Map(
    toolResults.map((toolResult) => [String(toolResult.toolCallId ?? ""), toolResult]),
  );

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
        mimeType: typeof block.mimeType === "string" ? block.mimeType : undefined,
        data: typeof block.data === "string" ? block.data : undefined,
        uri: typeof block.uri === "string" ? block.uri : undefined,
      });
      continue;
    }

    if (block.type === "toolCall" && typeof block.id === "string" && typeof block.name === "string") {
      const matched = toolResultsById.get(block.id);
      const matchedText = matched ? extractTextFromContent(matched.content) : "";
      blocks.push({
        type: "tool_call",
        toolCallId: block.id,
        toolName: block.name,
        args:
          block.arguments && typeof block.arguments === "object"
            ? (block.arguments as Record<string, unknown>)
            : null,
        status: matched ? (matched.isError ? "failed" : "completed") : "running",
        resultPreview: matchedText || (matched ? JSON.stringify(matched.content ?? null) : null),
      });
    }
  }

  return blocks;
};

const toToolCallRecords = (
  assistantMessage: Record<string, unknown>,
  toolResults: Array<Record<string, unknown>>,
): PersistMessagePayload["toolCalls"] => {
  const toolResultsById = new Map(
    toolResults.map((toolResult) => [String(toolResult.toolCallId ?? ""), toolResult]),
  );
  const content = Array.isArray(assistantMessage.content) ? assistantMessage.content : [];

  const calls: PersistMessagePayload["toolCalls"] = [];
  for (const item of content) {
    if (!item || typeof item !== "object") continue;
    const block = item as Record<string, unknown>;
    if (block.type === "toolCall" && typeof block.id === "string" && typeof block.name === "string") {
      const matched = toolResultsById.get(block.id);
      const matchedText = matched ? extractTextFromContent(matched.content) : "";
      calls.push({
        toolCallId: block.id,
        toolName: block.name,
        title: typeof block.title === "string" ? block.title : block.name,
        kind: typeof block.kind === "string" ? block.kind : null,
        status: matched ? (matched.isError ? "failed" : "completed") : "pending",
        args: block.arguments,
        result: matched ?? null,
        content: matched
          ? [
              {
                type: "content",
                content: {
                  type: "text",
                  text: matchedText || JSON.stringify(matched.content ?? null),
                },
              },
            ]
          : null,
        rawInput: block.arguments,
        rawOutput: matched ?? null,
        resultPreview: matchedText || (matched ? JSON.stringify(matched.content ?? null) : null),
        isError: matched ? Boolean(matched.isError) : false,
        meta: { source: "pi" },
      });
    }
  }

  return calls;
};

const summarizeToolArgs = (toolName: string, args: unknown): string => {
  if (!args || typeof args !== "object") return "";
  const record = args as Record<string, unknown>;

  if (toolName === "bash" && typeof record.command === "string") {
    return record.command.trim().slice(0, 120);
  }

  if (typeof record.path === "string") return record.path;
  if (typeof record.pattern === "string" && typeof record.path === "string") {
    return `${record.pattern} in ${record.path}`;
  }
  if (typeof record.query === "string") return record.query;

  const first = Object.entries(record)
    .filter(([, value]) => typeof value === "string" || typeof value === "number" || typeof value === "boolean")
    .slice(0, 2)
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(" ");
  return first.slice(0, 120);
};

const toToolCallRenderStates = (
  assistantMessage: Record<string, unknown>,
  toolResults: Array<Record<string, unknown>>,
) => {
  const toolResultsById = new Map(
    toolResults.map((toolResult) => [String(toolResult.toolCallId ?? ""), toolResult]),
  );
  const content = Array.isArray(assistantMessage.content) ? assistantMessage.content : [];

  return content
    .filter(
      (item): item is Record<string, unknown> =>
        !!item && typeof item === "object" && (item as Record<string, unknown>).type === "toolCall",
    )
    .map((block) => {
      const toolCallId = typeof block.id === "string" ? block.id : null;
      const toolName = typeof block.name === "string" ? block.name : "tool";
      const matched = toolCallId ? toolResultsById.get(toolCallId) : null;
      return {
        toolCallId,
        toolName,
        status: matched ? (matched.isError ? "failed" : "done") : "running",
        summary: summarizeToolArgs(toolName, block.arguments),
      };
    });
};

const summarizeThinking = (thinking: string): string => {
  const trimmed = thinking.trim();
  if (!trimmed) return "";
  const lines = trimmed.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  return lines.slice(0, 3).join("\n").slice(0, 600);
};

export async function registerRuntimeSession(input: RegisterRuntimeSessionInput) {
  const url = `${INTERNAL_API_BASE_URL}/internal/runtimes/${input.runtimeId}/sessions`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
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

export async function updateProviderRender(input: {
  runtimeId: string;
  runtimeSessionId: string;
  renderMode?: string | null;
  thinking?: string | null;
  toolCalls?: Array<Record<string, unknown>> | null;
  answer?: string | null;
  sourceMessageId?: string | null;
  anchorUserMessageId?: string | null;
}) {
  const url = `${INTERNAL_API_BASE_URL}/internal/runtimes/${input.runtimeId}/sessions/${input.runtimeSessionId}/provider-render`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Update provider render failed ${response.status}: ${text}`);
  }
}

export async function persistAssistantMessage(input: {
  runtimeId: string;
  runtimeSessionId: string;
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
  const toolCalls = toToolCallRecords(assistant, toolResultsRaw) ?? [];
  const thinking = extractThinkingFromContent(assistant.content);
  const toolCallRenderStates = toToolCallRenderStates(assistant, toolResultsRaw);
  const content = toAcpCompatibleContent(assistant, toolResultsRaw);
  const text = extractTextFromContent(assistant.content);

  if (content.length === 0 && !text.trim() && toolCalls.length === 0) {
    console.warn("[Persist] skipping empty assistant message", {
      runtimeId: input.runtimeId,
      runtimeSessionId: input.runtimeSessionId,
      userMessageId: input.userMessageId,
      stopReason: typeof assistant.stopReason === "string" ? assistant.stopReason : null,
    });
    return;
  }

  const payload: PersistMessagePayload = {
    runtimeId: input.runtimeId,
    sessionId: input.runtimeSessionId,
    previousMessageId: input.userMessageId,
    anchorUserMessageId: input.userMessageId,
    idempotencyKey: "",
    message: {
      role: "assistant",
      source: "pi",
      externalMessageId: typeof assistant.id === "string" ? assistant.id : null,
      protocolMessageId: typeof assistant.id === "string" ? assistant.id : null,
      content,
      text,
      provider: typeof assistant.provider === "string" ? assistant.provider : null,
      model: typeof assistant.model === "string" ? assistant.model : null,
      stopReason: typeof assistant.stopReason === "string" ? assistant.stopReason : null,
      errorMessage: typeof assistant.errorMessage === "string" ? assistant.errorMessage : null,
      meta: {
        source: "pi",
        runtimeId: input.runtimeId,
        sessionId: input.runtimeSessionId,
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
              totalTokens:
                typeof (assistant.usage as Record<string, unknown>).totalTokens === "number"
                  ? ((assistant.usage as Record<string, unknown>).totalTokens as number)
                  : undefined,
              costTotal:
                assistant.usage &&
                typeof (assistant.usage as Record<string, unknown>).cost === "object" &&
                typeof (((assistant.usage as Record<string, unknown>).cost as Record<string, unknown>).total) ===
                  "number"
                  ? ((((assistant.usage as Record<string, unknown>).cost as Record<string, unknown>).total as number) ??
                      undefined)
                  : undefined,
            }
          : null,
    },
    toolCalls,
  };

  payload.idempotencyKey = buildAssistantIdempotencyKey({
    previousMessageId: payload.previousMessageId ?? "root",
    message: payload.message,
    toolCalls: payload.toolCalls ?? [],
  });

  const url = `${INTERNAL_API_BASE_URL}/internal/runtimes/${input.runtimeId}/sessions/${input.runtimeSessionId}/messages`;
  const maxAttempts = 3;
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(`Persist API responded ${response.status}: ${text}`);
      }

      return;
    } catch (error) {
      lastError = error;
      if (attempt < maxAttempts) {
        await sleep(500 * attempt);
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
