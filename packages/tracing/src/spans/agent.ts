import { trace, context, type Span, SpanStatusCode, type Tracer } from "@opentelemetry/api";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TRACER_NAME = "cohub-agent";

export function getAgentTracer(): Tracer {
  return trace.getTracer(TRACER_NAME);
}

// ---------------------------------------------------------------------------
// LLM completion spans
// ---------------------------------------------------------------------------

type LlmSpanOptions = {
  provider: string;
  model: string;
  turn?: number;
  messageCount?: number;
  spaceId?: string;
  sessionId?: string;
};

/**
 * Wrap an LLM stream call with a span that records provider, model, turn number,
 * and usage information (tokens, cost) when available.
 *
 * Usage in session-runtime.ts createStreamFn:
 *   return wrapLlmCompletion(tracer, stream, { provider, model, turn: 1 }, async () => {
 *     return streamSimple(model, context, options);
 *   });
 */
export async function wrapLlmCompletion<T>(
  tracer: Tracer,
  options: LlmSpanOptions,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  const span = tracer.startSpan("llm.completion", {
    attributes: {
      "llm.provider": options.provider,
      "llm.model": options.model,
      "llm.turn": options.turn ?? 0,
      "llm.message_count": options.messageCount ?? 0,
      "gen_ai.system": mapProviderToGenAiSystem(options.provider),
      ...(options.spaceId ? { "cohub.space_id": options.spaceId } : {}),
      ...(options.sessionId ? { "cohub.session_id": options.sessionId } : {}),
    },
  });

  return context.with(trace.setSpan(context.active(), span), async () => {
    try {
      const result = await fn(span);
      return result;
    } catch (error) {
      if (error instanceof Error) {
        span.recordException(error);
      }
      span.setStatus({ code: SpanStatusCode.ERROR, message: String(error) });
      throw error;
    } finally {
      span.end();
    }
  });
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

type ToolCallOptions = {
  toolName: string;
  input?: Record<string, unknown>;
  spaceId?: string;
  sessionId?: string;
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
  const span = tracer.startSpan(`tool.call:${options.toolName}`, {
    attributes: {
      "tool.name": options.toolName,
      "tool.input.summary": inputSummary,
      ...(options.spaceId ? { "cohub.space_id": options.spaceId } : {}),
      ...(options.sessionId ? { "cohub.session_id": options.sessionId } : {}),
    },
  });

  return context.with(trace.setSpan(context.active(), span), async () => {
    try {
      const result = await fn(span);
      return result;
    } catch (error) {
      if (error instanceof Error) {
        span.recordException(error);
      }
      span.setStatus({ code: SpanStatusCode.ERROR, message: String(error) });
      throw error;
    } finally {
      span.end();
    }
  });
}

// ---------------------------------------------------------------------------
// Sandbox RPC spans
// ---------------------------------------------------------------------------

type SandboxRpcOptions = {
  method: string;
  sandboxId?: string;
  spaceId?: string;
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
  const span = tracer.startSpan(`sandbox.rpc:${options.method}`, {
    attributes: {
      "sandbox.rpc.method": options.method,
      "sandbox.rpc.params.summary": paramsSummary,
      ...(options.sandboxId ? { "sandbox.id": options.sandboxId } : {}),
      ...(options.spaceId ? { "cohub.space_id": options.spaceId } : {}),
    },
  });

  return context.with(trace.setSpan(context.active(), span), async () => {
    try {
      const start = performance.now();
      const result = await fn(span);
      span.setAttribute("sandbox.rpc.duration_ms", Math.round(performance.now() - start));
      return result;
    } catch (error) {
      span.setAttribute("sandbox.rpc.duration_ms", 0);
      if (error instanceof Error) {
        span.recordException(error);
      }
      span.setStatus({ code: SpanStatusCode.ERROR, message: String(error) });
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
