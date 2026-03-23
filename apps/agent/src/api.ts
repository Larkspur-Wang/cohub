import { createHash } from "node:crypto";
import type {
  PersistMessageInput,
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
  if (value === null || value === undefined) {
    return JSON.stringify(value);
  }

  if (typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item)).join(",")}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>).sort(
    ([a], [b]) => a.localeCompare(b),
  );

  return `{${entries
    .map(
      ([key, nestedValue]) =>
        `${JSON.stringify(key)}:${stableSerialize(nestedValue)}`,
    )
    .join(",")}}`;
};

const buildAssistantIdempotencyKey = (input: {
  parentMessageId: string;
  message: PersistMessagePayload["message"];
  toolCalls: PersistMessagePayload["toolCalls"];
}) => {
  return createHash("sha256")
    .update(
      stableSerialize({
        parentMessageId: input.parentMessageId,
        role: "assistant",
        message: input.message,
        toolCalls: input.toolCalls,
      }),
    )
    .digest("hex");
};

const extractTextFromContent = (content: unknown): string => {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return "";
  }

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
      if (item.type === "text" && typeof item.text === "string") {
        return [item.text];
      }
      if (
        item.type === "resource" &&
        item.resource &&
        typeof item.resource.text === "string"
      ) {
        return [item.resource.text];
      }
      if (item.type === "resource_link") {
        return [item.title || item.name || item.uri || ""];
      }
      return [];
    })
    .join("\n")
    .trim();
};

const toAcpCompatibleContent = (
  assistantMessage: Record<string, unknown>,
): UnifiedContentBlock[] => {
  const content = assistantMessage.content;
  const blocks: PersistMessagePayload["message"]["content"] = [];

  if (!Array.isArray(content)) {
    return blocks;
  }

  for (const item of content) {
    if (!item || typeof item !== "object") continue;
    const block = item as Record<string, unknown>;

    if (block.type === "text" && typeof block.text === "string") {
      blocks.push({ type: "text", text: block.text });
      continue;
    }

    if (block.type === "image") {
      blocks.push({
        type: "image",
        mimeType:
          typeof block.mimeType === "string" ? block.mimeType : undefined,
        data: typeof block.data === "string" ? block.data : undefined,
        uri: typeof block.uri === "string" ? block.uri : undefined,
      });
      continue;
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
  const content = Array.isArray(assistantMessage.content)
    ? assistantMessage.content
    : [];

  const calls: PersistMessagePayload["toolCalls"] = [];
  for (const item of content) {
    if (!item || typeof item !== "object") continue;
    const block = item as Record<string, unknown>;
    if (
      block.type === "toolCall" &&
      typeof block.id === "string" &&
      typeof block.name === "string"
    ) {
      const matched = toolResultsById.get(block.id);
      const matchedText = matched ? extractTextFromContent(matched.content) : "";
      calls.push({
        toolCallId: block.id,
        toolName: block.name,
        title: typeof block.title === "string" ? block.title : block.name,
        kind: typeof block.kind === "string" ? block.kind : null,
        status: matched
          ? Boolean(matched.isError)
            ? "failed"
            : "completed"
          : "pending",
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
        resultPreview:
          matchedText || (matched ? JSON.stringify(matched.content ?? null) : null),
        isError: matched ? Boolean(matched.isError) : false,
        meta: { source: "pi" },
      });
    }
  }

  return calls;
};

const buildToolCalls = (toolResults: Array<Record<string, unknown>>) => {
  return toolResults.map((toolResult) => {
    const contentText = extractTextFromContent(toolResult.content);
    return {
      toolCallId: String(toolResult.toolCallId ?? ""),
      toolName: String(toolResult.toolName ?? "unknown"),
      title: String(toolResult.toolName ?? "unknown"),
      kind: null,
      status: Boolean(toolResult.isError) ? "failed" : "completed",
      result: toolResult,
      content: [
        {
          type: "content" as const,
          content: {
            type: "text" as const,
            text: contentText || JSON.stringify(toolResult.content ?? null),
          },
        },
      ],
      rawOutput: toolResult,
      resultPreview: contentText || JSON.stringify(toolResult.content ?? null),
      isError: Boolean(toolResult.isError),
      meta: { source: "pi" },
    };
  });
};

export async function persistAssistantMessage(input: {
  sessionId: string;
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
  const toolCalls = toToolCallRecords(assistant, toolResultsRaw);
  const content = toAcpCompatibleContent(assistant);
  const text = extractTextFromContent(assistant.content);

  const payload: PersistMessagePayload = {
    sessionId: input.sessionId,
    parentMessageId: input.userMessageId,
    idempotencyKey: "",
    message: {
      role: "assistant",
      source: "pi",
      externalMessageId:
        typeof assistant.id === "string" ? assistant.id : null,
      content,
      text,
      provider:
        typeof assistant.provider === "string" ? assistant.provider : null,
      model: typeof assistant.model === "string" ? assistant.model : null,
      stopReason:
        typeof assistant.stopReason === "string" ? assistant.stopReason : null,
      errorMessage:
        typeof assistant.errorMessage === "string"
          ? assistant.errorMessage
          : null,
      meta: {
        source: "pi",
        rawStopReason:
          typeof assistant.stopReason === "string" ? assistant.stopReason : null,
      },
      usage:
        assistant.usage && typeof assistant.usage === "object"
          ? {
              input:
                typeof (assistant.usage as Record<string, unknown>).input ===
                "number"
                  ? ((assistant.usage as Record<string, unknown>)
                      .input as number)
                  : undefined,
              output:
                typeof (assistant.usage as Record<string, unknown>).output ===
                "number"
                  ? ((assistant.usage as Record<string, unknown>)
                      .output as number)
                  : undefined,
              totalTokens:
                typeof (assistant.usage as Record<string, unknown>)
                  .totalTokens === "number"
                  ? ((assistant.usage as Record<string, unknown>)
                      .totalTokens as number)
                  : undefined,
              costTotal:
                assistant.usage &&
                typeof (assistant.usage as Record<string, unknown>).cost ===
                  "object" &&
                typeof (
                  (assistant.usage as Record<string, unknown>).cost as Record<
                    string,
                    unknown
                  >
                ).total === "number"
                  ? (((
                      (assistant.usage as Record<string, unknown>)
                        .cost as Record<string, unknown>
                    ).total as number) ?? undefined)
                  : undefined,
            }
          : null,
    },
    toolCalls,
  };

  payload.idempotencyKey = buildAssistantIdempotencyKey({
    parentMessageId: payload.parentMessageId,
    message: payload.message,
    toolCalls: payload.toolCalls,
  });

  const url = `${INTERNAL_API_BASE_URL}/internal/sessions/${input.sessionId}/messages`;
  const maxAttempts = 3;
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(
          `Failed to persist assistant message: ${response.status} ${text}`,
        );
      }

      return;
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts) {
        break;
      }

      const delayMs = 300 * 2 ** (attempt - 1);
      console.warn(
        `[Persist] attempt ${attempt}/${maxAttempts} failed, retrying in ${delayMs}ms:`,
        error,
      );
      await sleep(delayMs);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(String(lastError ?? "Unknown persistence error"));
}
