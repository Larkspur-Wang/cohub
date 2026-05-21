import type { ContentBlock } from "@cohub/protocol/core";

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
      rawInput?: string;
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
  partialResult?: string | ContentBlock[];
};

type ToolResultState = {
  tool_use_id: string;
  content: string | ContentBlock[];
  is_error: boolean;
  _meta?: Record<string, unknown>;
};

export type AssistantStreamState = {
  blocksByIndex: Map<number, StreamBlock>;
  orderedIndexes: number[];
  toolMetaById: Map<string, ToolMeta>;
  toolResultsById: Map<string, ToolResultState>;
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
    blocksByIndex: new Map(),
    orderedIndexes: [],
    toolMetaById: new Map(),
    toolResultsById: new Map(),
  };
}

function upsertBlock(state: AssistantStreamState, block: StreamBlock): AssistantStreamState {
  if (!state.blocksByIndex.has(block.contentIndex)) {
    state.orderedIndexes.push(block.contentIndex);
    state.orderedIndexes.sort((a, b) => a - b);
  }
  state.blocksByIndex.set(block.contentIndex, block);
  return state;
}

function getBlock(state: AssistantStreamState, contentIndex: number): StreamBlock | undefined {
  return state.blocksByIndex.get(contentIndex);
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
        rawInput: existing?.kind === "tool_use" ? existing.rawInput : undefined,
        done: false,
      });
    }
    case "toolcall_delta": {
      const existing = getBlock(state, event.contentIndex);
      const partialToolCall = getToolCallFromPartial(event.partial, event.contentIndex);
      if (existing?.kind !== "tool_use" && !partialToolCall) return state;
      const rawInput = `${existing?.kind === "tool_use" ? existing.rawInput ?? "" : ""}${event.delta}`;
      return upsertBlock(state, {
        kind: "tool_use",
        contentIndex: event.contentIndex,
        id: partialToolCall?.id ?? (existing?.kind === "tool_use" ? existing.id : ""),
        name: partialToolCall?.name ?? (existing?.kind === "tool_use" ? existing.name : ""),
        input: partialToolCall?.arguments ?? (existing?.kind === "tool_use" ? existing.input : {}),
        rawInput,
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
        rawInput: undefined,
        done: true,
      });
    }
  }
}

export function applyToolExecutionStart(
  state: AssistantStreamState,
  input: { toolCallId: string; summary: string },
): AssistantStreamState {
  state.toolMetaById.set(input.toolCallId, {
    ...(state.toolMetaById.get(input.toolCallId) ?? {}),
    toolStatus: "running",
    summary: input.summary,
  });
  return state;
}

export function applyToolExecutionUpdate(
  state: AssistantStreamState,
  input: {
    toolCallId: string;
    content: string | ContentBlock[];
  },
): AssistantStreamState {
  state.toolMetaById.set(input.toolCallId, {
    ...(state.toolMetaById.get(input.toolCallId) ?? {}),
    toolStatus: "running",
    partialResult: input.content,
  });
  return state;
}

export function applyToolExecutionEnd(
  state: AssistantStreamState,
  input: {
    toolCallId: string;
    content: string | ContentBlock[];
    isError: boolean;
  },
): AssistantStreamState {
  const { partialResult: _partialResult, ...previousMeta } = state.toolMetaById.get(input.toolCallId) ?? {};
  state.toolMetaById.set(input.toolCallId, {
    ...previousMeta,
    toolStatus: input.isError ? "failed" : "done",
  });

  state.toolResultsById.set(input.toolCallId, {
    tool_use_id: input.toolCallId,
    content: input.content,
    is_error: input.isError,
    _meta: { toolStatus: input.isError ? "failed" : "done" },
  });

  return state;
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

function getContentBlockStreamIndex(block: ContentBlock): number | null {
  const value = block._meta?.streamIndex;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeToolCallContentBlock(block: Record<string, unknown>): ContentBlock | null {
  if (typeof block.id !== "string" || typeof block.name !== "string") return null;
  return {
    type: "tool_use",
    id: block.id,
    name: block.name,
    input:
      block.input && typeof block.input === "object"
        ? (block.input as Record<string, unknown>)
        : block.arguments && typeof block.arguments === "object"
          ? (block.arguments as Record<string, unknown>)
          : {},
    ...(block._meta && typeof block._meta === "object" ? { _meta: block._meta as Record<string, unknown> } : {}),
  };
}

function normalizeFinalContentBlock(block: ContentBlock | Record<string, unknown>): ContentBlock | null {
  if (!block || typeof block !== "object") return null;
  if (block.type === "text" && typeof block.text === "string") return block as ContentBlock;
  if (block.type === "thinking" && typeof block.thinking === "string") return block as ContentBlock;
  if (block.type === "image") return block as ContentBlock;
  if (block.type === "tool_use" && typeof block.id === "string") return block as ContentBlock;
  if (block.type === "toolCall") return normalizeToolCallContentBlock(block as Record<string, unknown>);
  if (block.type === "tool_result" && typeof block.tool_use_id === "string") return block as ContentBlock;
  if (block.type === "shell_command") return block as ContentBlock;
  return null;
}

function stripStreamMeta(block: ContentBlock): ContentBlock {
  const { _meta, ...rest } = block as ContentBlock & { _meta?: Record<string, unknown> };
  if (!_meta || Object.keys(_meta).every((key) => key === "streamIndex")) {
    return rest as ContentBlock;
  }
  const { streamIndex: _streamIndex, ...meta } = _meta;
  return Object.keys(meta).length > 0
    ? ({ ...rest, _meta: meta } as ContentBlock)
    : (rest as ContentBlock);
}

function finalBlockIdentity(block: ContentBlock): string | null {
  if (block.type === "tool_use") return `tool_use:${block.id}`;
  if (block.type === "tool_result") return `tool_result:${block.tool_use_id}`;
  const streamIndex = getContentBlockStreamIndex(block);
  if (streamIndex != null) return `${block.type}:stream:${streamIndex}`;
  return null;
}

function streamBlockIdentity(block: ContentBlock): string | null {
  if (block.type === "tool_use") return `tool_use:${block.id}`;
  if (block.type === "tool_result") return `tool_result:${block.tool_use_id}`;
  const streamIndex = getContentBlockStreamIndex(block);
  if (streamIndex != null) return `${block.type}:stream:${streamIndex}`;
  return null;
}

function contentBlocksCompatible(streamBlock: ContentBlock, finalBlock: ContentBlock): boolean {
  if (streamBlock.type !== finalBlock.type) return false;
  if (streamBlock.type === "tool_use" && finalBlock.type === "tool_use") return streamBlock.id === finalBlock.id;
  if (streamBlock.type === "tool_result" && finalBlock.type === "tool_result") return streamBlock.tool_use_id === finalBlock.tool_use_id;
  return true;
}

export function mergeFinalAssistantContentWithStreamOrder(
  finalContent: unknown[],
  streamContent: ContentBlock[],
): ContentBlock[] {
  const normalizedFinal = finalContent
    .map((block) => normalizeFinalContentBlock(block as ContentBlock | Record<string, unknown>))
    .filter((block): block is ContentBlock => Boolean(block));
  if (streamContent.length === 0 || normalizedFinal.length === 0) {
    return normalizedFinal.map(stripStreamMeta);
  }

  const usedFinal = new Set<ContentBlock>();
  const ordered: ContentBlock[] = [];
  for (const streamBlock of streamContent) {
    const streamIdentity = streamBlockIdentity(streamBlock);
    const exact = streamIdentity
      ? normalizedFinal.find((block) => !usedFinal.has(block) && finalBlockIdentity(block) === streamIdentity)
      : null;
    const compatible = exact ?? normalizedFinal.find((block) => !usedFinal.has(block) && contentBlocksCompatible(streamBlock, block));
    if (!compatible) continue;
    ordered.push(stripStreamMeta(compatible));
    usedFinal.add(compatible);
  }

  return [
    ...ordered,
    ...normalizedFinal
      .filter((block) => !usedFinal.has(block))
      .map(stripStreamMeta),
  ];
}

export function projectAssistantStreamState(state: AssistantStreamState): ContentBlock[] {
  const content: ContentBlock[] = [];

  for (const contentIndex of state.orderedIndexes) {
    const block = state.blocksByIndex.get(contentIndex);
    if (!block) continue;
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
      _meta: withStreamIndexMeta(
        block.rawInput
          ? { ...(meta ?? {}), rawInput: block.rawInput }
          : meta,
        block.contentIndex,
      ),
    });

    const result = state.toolResultsById.get(block.id);
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
