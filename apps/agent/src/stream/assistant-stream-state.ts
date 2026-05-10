import type { ContentBlock } from "@neta-art/cohub-protocol/core";

type ToolStatus = "running" | "done" | "failed";

type StreamBlock =
  | {
      kind: "thinking";
      contentIndex: number;
      thinking: string;
      signature?: string;
      done: boolean;
    }
  | {
      kind: "text";
      contentIndex: number;
      text: string;
      done: boolean;
    }
  | {
      kind: "tool_use";
      contentIndex: number;
      id: string;
      name: string;
      input: Record<string, unknown>;
      done: boolean;
    }
  | {
      kind: "image";
      contentIndex: number;
      source: Extract<ContentBlock, { type: "image" }>["source"];
    };

type ToolMeta = {
  toolStatus?: ToolStatus;
  summary?: string;
};

type ToolResultState = {
  tool_use_id: string;
  content: string | ContentBlock[];
  is_error: boolean;
  _meta?: Record<string, unknown>;
};

export type AssistantStreamState = {
  blocks: StreamBlock[];
  toolMetaById: Map<string, ToolMeta>;
  toolResultsById: Map<string, ToolResultState>;
  partialToolResultsById: Map<string, ToolResultState>;
};

type AssistantToolCall = {
  id?: string;
  name?: string;
  arguments?: Record<string, unknown>;
};

type AssistantPartial = {
  content?: Array<Record<string, unknown> | null | undefined>;
};

type AssistantMessageEvent =
  | { type: "start"; partial?: unknown }
  | { type: "text_start"; contentIndex: number; partial?: unknown }
  | { type: "text_delta"; contentIndex: number; delta: string; partial?: unknown }
  | { type: "text_end"; contentIndex: number; content: string; partial?: unknown }
  | { type: "thinking_start"; contentIndex: number; partial?: unknown }
  | { type: "thinking_delta"; contentIndex: number; delta: string; partial?: unknown }
  | { type: "thinking_end"; contentIndex: number; content: string; partial?: unknown }
  | { type: "toolcall_start"; contentIndex: number; partial?: unknown }
  | { type: "toolcall_delta"; contentIndex: number; delta: string; partial?: unknown }
  | { type: "toolcall_end"; contentIndex: number; toolCall: AssistantToolCall; partial?: unknown }
  | { type: "done"; message?: unknown }
  | { type: "error"; error?: unknown; reason?: string };

export function createAssistantStreamState(): AssistantStreamState {
  return {
    blocks: [],
    toolMetaById: new Map(),
    toolResultsById: new Map(),
    partialToolResultsById: new Map(),
  };
}

function upsertBlock(state: AssistantStreamState, block: StreamBlock): AssistantStreamState {
  const existingIndex = state.blocks.findIndex((b) => b.contentIndex === block.contentIndex);
  const blocks = [...state.blocks];
  if (existingIndex === -1) blocks.push(block);
  else blocks[existingIndex] = block;
  blocks.sort((a, b) => a.contentIndex - b.contentIndex);
  return { ...state, blocks };
}

function getBlock(state: AssistantStreamState, contentIndex: number): StreamBlock | undefined {
  return state.blocks.find((b) => b.contentIndex === contentIndex);
}

function getThinkingSignature(partial: unknown, contentIndex: number): string | undefined {
  if (!partial || typeof partial !== "object" || !("content" in partial)) return undefined;
  const content = (partial as { content?: unknown }).content;
  if (!Array.isArray(content)) return undefined;
  const block = content[contentIndex];
  if (!block || typeof block !== "object") return undefined;
  const record = block as Record<string, unknown>;
  return typeof record.signature === "string"
    ? record.signature
    : typeof record.thinkingSignature === "string"
      ? record.thinkingSignature
      : undefined;
}

function getToolCallFromPartial(partial: unknown, contentIndex: number): AssistantToolCall | null {
  if (!partial || typeof partial !== "object") return null;
  const content = (partial as AssistantPartial).content;
  if (!Array.isArray(content)) return null;
  const block = content[contentIndex];
  if (!block || typeof block !== "object") return null;
  const record = block as Record<string, unknown>;
  if (record.type !== "toolCall") return null;
  return {
    id: typeof record.id === "string" ? record.id : undefined,
    name: typeof record.name === "string" ? record.name : undefined,
    arguments:
      record.arguments && typeof record.arguments === "object"
        ? (record.arguments as Record<string, unknown>)
        : undefined,
  };
}

export function applyAssistantMessageEvent(
  state: AssistantStreamState,
  event: AssistantMessageEvent,
): AssistantStreamState {
  switch (event.type) {
    case "start":
    case "done":
    case "error":
      return state;
    case "text_start": {
      return upsertBlock(state, { kind: "text", contentIndex: event.contentIndex, text: "", done: false });
    }
    case "text_delta": {
      const existing = getBlock(state, event.contentIndex);
      const text = existing?.kind === "text" ? existing.text + event.delta : event.delta;
      return upsertBlock(state, { kind: "text", contentIndex: event.contentIndex, text, done: false });
    }
    case "text_end": {
      return upsertBlock(state, {
        kind: "text",
        contentIndex: event.contentIndex,
        text: event.content,
        done: true,
      });
    }
    case "thinking_start": {
      return upsertBlock(state, { kind: "thinking", contentIndex: event.contentIndex, thinking: "", done: false });
    }
    case "thinking_delta": {
      const existing = getBlock(state, event.contentIndex);
      const thinking = existing?.kind === "thinking" ? existing.thinking + event.delta : event.delta;
      return upsertBlock(state, {
        kind: "thinking",
        contentIndex: event.contentIndex,
        thinking,
        signature: existing?.kind === "thinking" ? existing.signature : undefined,
        done: false,
      });
    }
    case "thinking_end": {
      const existing = getBlock(state, event.contentIndex);
      return upsertBlock(state, {
        kind: "thinking",
        contentIndex: event.contentIndex,
        thinking: event.content,
        signature: getThinkingSignature(event.partial, event.contentIndex) ?? (existing?.kind === "thinking" ? existing.signature : undefined),
        done: true,
      });
    }
    case "toolcall_start": {
      const existing = getBlock(state, event.contentIndex);
      const partialToolCall = getToolCallFromPartial(event.partial, event.contentIndex);
      return upsertBlock(state, {
        kind: "tool_use",
        contentIndex: event.contentIndex,
        id: partialToolCall?.id ?? (existing?.kind === "tool_use" ? existing.id : ""),
        name: partialToolCall?.name ?? (existing?.kind === "tool_use" ? existing.name : ""),
        input: partialToolCall?.arguments ?? (existing?.kind === "tool_use" ? existing.input : {}),
        done: false,
      });
    }
    case "toolcall_delta": {
      const existing = getBlock(state, event.contentIndex);
      const partialToolCall = getToolCallFromPartial(event.partial, event.contentIndex);
      if (existing?.kind !== "tool_use" && !partialToolCall) return state;
      return upsertBlock(state, {
        kind: "tool_use",
        contentIndex: event.contentIndex,
        id: partialToolCall?.id ?? (existing?.kind === "tool_use" ? existing.id : ""),
        name: partialToolCall?.name ?? (existing?.kind === "tool_use" ? existing.name : ""),
        input: partialToolCall?.arguments ?? (existing?.kind === "tool_use" ? existing.input : {}),
        done: false,
      });
    }
    case "toolcall_end": {
      return upsertBlock(state, {
        kind: "tool_use",
        contentIndex: event.contentIndex,
        id: event.toolCall.id ?? "",
        name: event.toolCall.name ?? "",
        input: event.toolCall.arguments ?? {},
        done: true,
      });
    }
  }
}

export function applyToolExecutionStart(
  state: AssistantStreamState,
  input: { toolCallId: string; summary: string },
): AssistantStreamState {
  const toolMetaById = new Map(state.toolMetaById);
  toolMetaById.set(input.toolCallId, {
    ...(toolMetaById.get(input.toolCallId) ?? {}),
    toolStatus: "running",
    summary: input.summary,
  });
  return { ...state, toolMetaById };
}

export function applyToolExecutionUpdate(
  state: AssistantStreamState,
  input: {
    toolCallId: string;
    content: string | ContentBlock[];
    isError?: boolean;
  },
): AssistantStreamState {
  const partialToolResultsById = new Map(state.partialToolResultsById);
  partialToolResultsById.set(input.toolCallId, {
    tool_use_id: input.toolCallId,
    content: input.content,
    is_error: input.isError ?? false,
    _meta: { toolStatus: "running", resultDetail: "partial" },
  });
  return { ...state, partialToolResultsById };
}

export function applyToolExecutionEnd(
  state: AssistantStreamState,
  input: {
    toolCallId: string;
    content: string | ContentBlock[];
    isError: boolean;
  },
): AssistantStreamState {
  const toolMetaById = new Map(state.toolMetaById);
  toolMetaById.set(input.toolCallId, {
    ...(toolMetaById.get(input.toolCallId) ?? {}),
    toolStatus: input.isError ? "failed" : "done",
  });

  const toolResultsById = new Map(state.toolResultsById);
  toolResultsById.set(input.toolCallId, {
    tool_use_id: input.toolCallId,
    content: input.content,
    is_error: input.isError,
    _meta: { toolStatus: input.isError ? "failed" : "done" },
  });

  const partialToolResultsById = new Map(state.partialToolResultsById);
  partialToolResultsById.delete(input.toolCallId);

  return { ...state, toolMetaById, toolResultsById, partialToolResultsById };
}

function withStreamIndexMeta(
  meta: Record<string, unknown> | undefined,
  streamIndex: number,
): Record<string, unknown> {
  return {
    ...(meta ?? {}),
    streamIndex,
  };
}

export function projectAssistantStreamState(state: AssistantStreamState): ContentBlock[] {
  const orderedBlocks = [...state.blocks].sort((a, b) => a.contentIndex - b.contentIndex);
  const content: ContentBlock[] = [];

  for (const block of orderedBlocks) {
    if (block.kind === "thinking") {
      content.push({
        type: "thinking",
        thinking: block.thinking,
        ...(block.signature ? { signature: block.signature } : {}),
        _meta: withStreamIndexMeta(undefined, block.contentIndex),
      });
      continue;
    }

    if (block.kind === "text") {
      content.push({
        type: "text",
        text: block.text,
        _meta: withStreamIndexMeta(undefined, block.contentIndex),
      });
      continue;
    }

    if (block.kind === "image") {
      content.push({
        type: "image",
        source: block.source,
        _meta: withStreamIndexMeta(undefined, block.contentIndex),
      });
      continue;
    }

    const meta = state.toolMetaById.get(block.id);
    if (!block.id || !block.name) continue;
    content.push({
      type: "tool_use",
      id: block.id,
      name: block.name,
      input: block.input,
      _meta: withStreamIndexMeta(meta, block.contentIndex),
    });

    const result = state.toolResultsById.get(block.id) ?? state.partialToolResultsById.get(block.id);
    if (result) {
      content.push({
        type: "tool_result",
        tool_use_id: result.tool_use_id,
        content: result.content,
        is_error: result.is_error,
        _meta: withStreamIndexMeta(
          (result._meta as Record<string, unknown> | undefined) ?? undefined,
          block.contentIndex,
        ),
      });
    }
  }

  return content;
}
