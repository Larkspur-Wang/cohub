import { context, trace, type Span, SpanStatusCode, type Tracer } from "@opentelemetry/api";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TRACER_NAME = "cohub-agent";

export function getAgentTracer(): Tracer {
  return trace.getTracer(TRACER_NAME);
}

// ---------------------------------------------------------------------------
// Shared types / helpers
// ---------------------------------------------------------------------------

type AgentContextAttributes = {
  spaceId?: string;
  sessionId?: string;
  turnId?: string;
  turnSeq?: number;
  llmRound?: number;
  toolCallId?: string;
};

function buildAgentContextAttributes(options: AgentContextAttributes) {
  return {
    ...(options.spaceId ? { "cohub.space_id": options.spaceId } : {}),
    ...(options.sessionId ? { "cohub.session_id": options.sessionId } : {}),
    ...(options.turnId ? { "agent.turn_id": options.turnId } : {}),
    ...(options.turnSeq != null ? { "agent.turn_seq": options.turnSeq } : {}),
    ...(options.llmRound != null ? { "agent.llm_round": options.llmRound } : {}),
    ...(options.toolCallId ? { "agent.tool_call_id": options.toolCallId } : {}),
  };
}

function markSpanError(span: Span, error: unknown) {
  if (error instanceof Error) {
    span.recordException(error);
  }
  span.setStatus({ code: SpanStatusCode.ERROR, message: String(error) });
}

// ---------------------------------------------------------------------------
// Agent turn spans
// ---------------------------------------------------------------------------

type AgentTurnSpanOptions = AgentContextAttributes & {
  action: string;
  mode?: "prompt" | "steer" | "abort";
  userMessageId?: string | null;
  modelProvider?: string;
  modelId?: string;
  isResumedSession?: boolean;
};

export async function wrapAgentTurn<T>(
  tracer: Tracer,
  options: AgentTurnSpanOptions,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  const span = tracer.startSpan("agent.turn", {
    attributes: {
      "agent.action": options.action,
      ...(options.mode ? { "agent.execution_mode": options.mode } : {}),
      ...(options.userMessageId ? { "agent.input_message_id": options.userMessageId } : {}),
      ...(options.modelProvider ? { "agent.model.provider": options.modelProvider } : {}),
      ...(options.modelId ? { "agent.model.id": options.modelId } : {}),
      ...(options.isResumedSession != null ? { "agent.is_resumed_session": options.isResumedSession } : {}),
      ...buildAgentContextAttributes(options),
    },
  });

  return context.with(trace.setSpan(context.active(), span), async () => {
    try {
      const result = await fn(span);
      return result;
    } catch (error) {
      markSpanError(span, error);
      throw error;
    } finally {
      span.end();
    }
  });
}

// ---------------------------------------------------------------------------
// LLM round spans
// ---------------------------------------------------------------------------

type LlmSpanOptions = AgentContextAttributes & {
  provider: string;
  model: string;
  messageCount?: number;
};

export function startLlmRoundSpan(
  tracer: Tracer,
  options: LlmSpanOptions,
) {
  const span = tracer.startSpan("llm.round", {
    attributes: {
      "llm.provider": options.provider,
      "llm.model": options.model,
      "llm.message_count": options.messageCount ?? 0,
      "gen_ai.system": mapProviderToGenAiSystem(options.provider),
      "gen_ai.request.model": options.model,
      ...buildAgentContextAttributes(options),
    },
  });

  const startedAt = performance.now();
  let ended = false;
  let firstTokenRecorded = false;

  return {
    span,
    context: trace.setSpan(context.active(), span),
    markFirstToken() {
      if (firstTokenRecorded) return;
      firstTokenRecorded = true;
      span.setAttribute("llm.first_token_ms", Math.round(performance.now() - startedAt));
      span.addEvent("llm.first_token");
    },
    finish(result?: {
      finishReason?: string;
      outcome?: "ok" | "error" | "aborted";
    }) {
      if (ended) return;
      ended = true;
      if (result?.finishReason) {
        span.setAttribute("llm.finish_reason", result.finishReason);
      }
      if (result?.outcome) {
        span.setAttribute("llm.outcome", result.outcome);
      }
      span.end();
    },
    fail(error: unknown, outcome: "error" | "aborted" = "error") {
      if (ended) return;
      ended = true;
      span.setAttribute("llm.outcome", outcome);
      markSpanError(span, error);
      span.end();
    },
  };
}

/** Record usage information on an LLM span. */
export function recordLlmUsage(
  span: Span,
  usage: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
    cost?: number;
  },
) {
  if (usage.inputTokens != null) span.setAttribute("gen_ai.usage.input_tokens", usage.inputTokens);
  if (usage.outputTokens != null) span.setAttribute("gen_ai.usage.output_tokens", usage.outputTokens);
  if (usage.totalTokens != null) span.setAttribute("gen_ai.usage.total_tokens", usage.totalTokens);
  if (usage.cacheReadTokens != null) span.setAttribute("gen_ai.usage.cache_read_tokens", usage.cacheReadTokens);
  if (usage.cacheWriteTokens != null) span.setAttribute("gen_ai.usage.cache_write_tokens", usage.cacheWriteTokens);
  if (usage.cost != null) span.setAttribute("gen_ai.usage.cost_usd", usage.cost);
}

// ---------------------------------------------------------------------------
// Tool call spans
// ---------------------------------------------------------------------------

type ToolCallOptions = AgentContextAttributes & {
  toolName: string;
  input?: Record<string, unknown>;
};

/**
 * Wrap a tool call with a span. Child spans (e.g. sandbox RPC) will automatically
 * be nested under this span.
 */
export async function wrapToolCall<T>(
  tracer: Tracer,
  options: ToolCallOptions,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  const inputSummary = summarizeToolInput(options.toolName, options.input);
  const span = tracer.startSpan("tool.call", {
    attributes: {
      "tool.name": options.toolName,
      "tool.input.summary": inputSummary,
      ...buildAgentContextAttributes(options),
    },
  });

  return context.with(trace.setSpan(context.active(), span), async () => {
    try {
      const result = await fn(span);
      span.setAttribute("tool.outcome", "ok");
      return result;
    } catch (error) {
      span.setAttribute("tool.outcome", "error");
      markSpanError(span, error);
      throw error;
    } finally {
      span.end();
    }
  });
}

// ---------------------------------------------------------------------------
// Sandbox RPC spans
// ---------------------------------------------------------------------------

type SandboxRpcOptions = AgentContextAttributes & {
  method: string;
  sandboxId?: string;
  params?: Record<string, unknown>;
};

/**
 * Wrap a sandbox RPC call with a span.
 */
export async function wrapSandboxRpc<T>(
  tracer: Tracer,
  options: SandboxRpcOptions,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  const paramsSummary = summarizeRpcParams(options.method, options.params);
  const span = tracer.startSpan("sandbox.rpc", {
    attributes: {
      "sandbox.rpc.method": options.method,
      "sandbox.rpc.params.summary": paramsSummary,
      ...(options.sandboxId ? { "sandbox.id": options.sandboxId } : {}),
      ...buildAgentContextAttributes(options),
    },
  });

  return context.with(trace.setSpan(context.active(), span), async () => {
    try {
      const result = await fn(span);
      return result;
    } catch (error) {
      markSpanError(span, error);
      throw error;
    } finally {
      span.end();
    }
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mapProviderToGenAiSystem(provider: string): string {
  const lower = provider.toLowerCase();
  if (lower.includes("openai")) return "openai";
  if (lower.includes("anthropic")) return "anthropic";
  if (lower.includes("google")) return "google_genai";
  if (lower.includes("bedrock") || lower.includes("aws")) return "aws_bedrock";
  return provider;
}

function summarizeToolInput(toolName: string, input?: Record<string, unknown>): string {
  if (!input) return "";
  if (toolName === "bash" && typeof input.command === "string") {
    return (input.command as string).trim().slice(0, 120);
  }
  if (typeof input.path === "string") return input.path as string;
  if (typeof input.pattern === "string" && typeof input.path === "string") {
    return `${input.pattern} in ${input.path}`;
  }
  const first = Object.entries(input)
    .filter(([, v]) => ["string", "number", "boolean"].includes(typeof v))
    .slice(0, 2)
    .map(([k, v]) => `${k}=${String(v)}`)
    .join(" ");
  return first.slice(0, 120);
}

function summarizeRpcParams(method: string, params?: Record<string, unknown>): string {
  if (!params) return "";
  if (method === "process.start" && typeof params.command === "string") {
    return (params.command as string).trim().slice(0, 120);
  }
  if (typeof params.path === "string") return params.path as string;
  if (method === "fs.grep" && typeof params.pattern === "string") {
    const path = typeof params.path === "string" ? params.path : ".";
    return `${params.pattern} in ${path}`;
  }
  return "";
}
