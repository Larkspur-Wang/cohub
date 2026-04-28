import { context, SpanKind, SpanStatusCode, trace } from "@opentelemetry/api";
import type { ContentBlock } from "@neta-art/cohub-protocol/core";
import type { PersistMessageInput, RegisterSessionInput } from "@neta-art/cohub-protocol/model";
import { config } from "./config.js";

const tracer = trace.getTracer("cohub-worker");
const INTERNAL_FETCH_SLOW_THRESHOLD_MS = Number(process.env.WORKER_INTERNAL_FETCH_SLOW_THRESHOLD_MS ?? 1000);
const formatDuration = (durationMs: number) => Math.round(durationMs * 10) / 10;

export class InternalApiError extends Error {
  constructor(
    message: string,
    public statusCode: number,
  ) {
    super(message);
    this.name = "InternalApiError";
  }
}

const internalFetch = async (path: string, options: RequestInit = {}) => {
  const url = `${config.internalApiBaseUrl}${path}`;
  const method = options.method ?? "GET";
  const activeSpan = trace.getActiveSpan();
  const span = activeSpan
    ? tracer.startSpan("worker.internal_api.request", {
      kind: SpanKind.CLIENT,
      attributes: {
        "http.request.method": method,
        "url.path": path,
      },
    })
    : null;

  return context.with(span ? trace.setSpan(context.active(), span) : context.active(), async () => {
    const startedAt = performance.now();
    try {
      const res = await fetch(url, {
        ...options,
        headers: {
          "Content-Type": "application/json",
          "x-worker-secret": config.workerSecret,
          ...options.headers,
        },
      });
      span?.setAttribute("http.response.status_code", res.status);

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new InternalApiError(
          `Internal API ${res.status} ${res.statusText}: ${body}`,
          res.status,
        );
      }
      return res.json();
    } catch (error) {
      span?.recordException(error instanceof Error ? error : new Error(String(error)));
      span?.setStatus({ code: SpanStatusCode.ERROR, message: String(error) });
      throw error;
    } finally {
      const durationMs = performance.now() - startedAt;
      span?.setAttribute("http.request.duration_ms", formatDuration(durationMs));
      if (durationMs >= INTERNAL_FETCH_SLOW_THRESHOLD_MS) {
        console.warn("[Worker Slow Internal API]", JSON.stringify({
          method,
          path,
          durationMs: formatDuration(durationMs),
          traceId: span?.spanContext().traceId,
          spanId: span?.spanContext().spanId,
        }));
      }
      span?.end();
    }
  });
};

export const sendSessionMessage = async (
  spaceId: string,
  sessionId: string,
  message: PersistMessageInput["message"],
) => {
  return internalFetch(
    `/internal/spaces/${spaceId}/sessions/${sessionId}/messages`,
    {
      method: "POST",
      body: JSON.stringify({
        idempotencyKey: `worker-${crypto.randomUUID()}`,
        message,
      }),
    },
  );
};

export const registerCronjobSession = async (
  spaceId: string,
  options: {
    source: string;
    title?: string | null;
  },
) => {
  const sessionId = crypto.randomUUID();
  const input: RegisterSessionInput = {
    spaceId,
    sessionId,
    title: options.title ?? null,
    source: options.source,
    externalSessionId: null,
    meta: { createdBy: "cronjob" },
  };
  const result = await internalFetch(
    `/internal/spaces/${spaceId}/sessions`,
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
  return result.session;
};

export const enqueuePrompt = async (
  spaceId: string,
  sessionId: string,
  options: {
    content: ContentBlock[];
    userMessageId?: string;
    meta?: Record<string, unknown> | null;
  },
) => {
  return internalFetch(
    `/internal/spaces/${spaceId}/sessions/${sessionId}/prompt`,
    {
      method: "POST",
      body: JSON.stringify({
        content: options.content,
        userMessageId: options.userMessageId,
        meta: options.meta,
      }),
    },
  );
};
