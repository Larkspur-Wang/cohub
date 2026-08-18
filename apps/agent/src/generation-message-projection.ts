import { normalizeContentBlockStrict } from "@cohub/core/content/normalize";
import type { ContentBlock } from "@cohub/protocol/core";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, TextContent } from "@earendil-works/pi-ai";

export type GenerationSessionMessage = {
  id: string;
  turnId: string | null;
  role: unknown;
  content: unknown;
  provider: string | null;
  model: string | null;
  errorMessage?: unknown;
  meta: unknown;
  createdAt: unknown;
};

export type CohubGenerationUserMessage = {
  role: "user";
  content: ContentBlock[];
  timestamp: number;
  meta: Record<string, unknown>;
};

declare module "@earendil-works/pi-agent-core" {
  interface CustomAgentMessages {
    cohubGenerationUser: CohubGenerationUserMessage;
  }
}

function recordOrEmpty(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function generationResultErrorMessage(content: unknown): string | null {
  if (!Array.isArray(content)) return null;
  for (const block of content) {
    if (!block || typeof block !== "object" || Array.isArray(block)) continue;
    const record = block as Record<string, unknown>;
    if (record.type !== "text" || typeof record.text !== "string") continue;
    try {
      const envelope = JSON.parse(record.text) as unknown;
      if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) continue;
      const result = envelope as Record<string, unknown>;
      if (result.type !== "generation.result" || !result.error || typeof result.error !== "object" || Array.isArray(result.error)) continue;
      const message = stringOrNull((result.error as Record<string, unknown>).message);
      if (message) return message;
    } catch {
      // Content validation reports malformed text blocks; non-JSON text is allowed.
    }
  }
  return null;
}

function normalizeGenerationContent(content: unknown, role: "user"): ContentBlock[];
function normalizeGenerationContent(content: unknown, role: "assistant"): TextContent[];
function normalizeGenerationContent(content: unknown, role: "user" | "assistant"): ContentBlock[] {
  if (!Array.isArray(content)) throw new Error("Invalid generation message content: expected an array");

  const normalized: ContentBlock[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object" || Array.isArray(block)) {
      throw new Error("Invalid generation content block: expected an object");
    }
    const record = block as Record<string, unknown>;
    if (record.type === "text") {
      if (typeof record.text !== "string") throw new Error("Invalid generation text block: expected text");
      normalized.push({ type: "text", text: record.text });
      continue;
    }
    if (record.type === "image") {
      const image = normalizeContentBlockStrict(record);
      if (image.type !== "image") throw new Error("Invalid generation image block");
      if (role === "user") normalized.push(image);
      continue;
    }
    throw new Error(`Unsupported generation content block: ${String(record.type)}`);
  }

  if (normalized.length === 0) throw new Error("Invalid generation message content: expected at least one supported block");
  return normalized;
}

export function projectGenerationSessionMessage(row: GenerationSessionMessage): AgentMessage {
  if (row.role !== "user" && row.role !== "assistant") {
    throw new Error(`Invalid generation message role: ${String(row.role)}`);
  }

  const meta = recordOrEmpty(row.meta);
  const createdAt = row.createdAt instanceof Date ? row.createdAt.getTime() : Number.NaN;
  const timestamp = Number.isFinite(createdAt) ? createdAt : Date.now();
  const projectedMeta = {
    ...meta,
    messageId: row.id,
    turnId: row.turnId,
  };
  if (row.role === "user") {
    const message = {
      role: "user",
      content: normalizeGenerationContent(row.content, "user"),
      timestamp,
      meta: projectedMeta,
    } satisfies CohubGenerationUserMessage;
    return message as unknown as AgentMessage;
  }

  const failed = meta.generationStatus === "failed";
  const errorMessage = failed
    ? stringOrNull(row.errorMessage) ?? stringOrNull(meta.errorMessage) ?? generationResultErrorMessage(row.content) ?? "Generation failed."
    : null;

  const message = {
    role: "assistant",
    content: normalizeGenerationContent(row.content, "assistant"),
    api: "generation",
    provider: stringOrNull(row.provider) ?? stringOrNull(meta.provider) ?? "generation",
    model: stringOrNull(row.model) ?? stringOrNull(meta.model) ?? "generation",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: failed ? "error" : "stop",
    ...(errorMessage ? { errorMessage } : {}),
    timestamp,
    meta: projectedMeta,
  } satisfies AssistantMessage & { meta: Record<string, unknown> };
  return message;
}
