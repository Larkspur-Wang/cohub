import { randomUUID } from "node:crypto";
import type { Context } from "@opentelemetry/api";
import { context, propagation, trace, type Span } from "@opentelemetry/api";
import { getRequestTraceContext } from "./async-context.js";

export const REQUEST_ID_HEADER = "x-request-id";
export const TRACE_ID_HEADER = "x-trace-id";
export const SPAN_ID_HEADER = "x-span-id";
export const TRACEPARENT_HEADER = "traceparent";

export type TraceIdentifiers = {
  requestId: string;
  traceId: string | null;
  spanId: string | null;
  traceparent: string | null;
};

const SAFE_REQUEST_ID_PATTERN = /^[a-zA-Z0-9._:-]{1,128}$/;

export function normalizeRequestId(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  if (!normalized) return null;
  return SAFE_REQUEST_ID_PATTERN.test(normalized) ? normalized : null;
}

export function getOrCreateRequestId(value?: string | null): string {
  return normalizeRequestId(value) ?? randomUUID();
}

export function getActiveTraceIdentifiers(requestId: string, activeContext: Context = context.active()): TraceIdentifiers {
  const spanContext = trace.getSpan(activeContext)?.spanContext();
  const traceparentCarrier: Record<string, string> = {};
  propagation.inject(activeContext, traceparentCarrier);

  return {
    requestId,
    traceId: spanContext?.traceId ?? null,
    spanId: spanContext?.spanId ?? null,
    traceparent: traceparentCarrier[TRACEPARENT_HEADER] ?? null,
  };
}

export function setRequestContextAttributes(span: Span | undefined, ids: TraceIdentifiers) {
  if (!span) return;
  span.setAttribute("cohub.request_id", ids.requestId);
  if (ids.traceId) span.setAttribute("cohub.trace_id", ids.traceId);
  if (ids.spanId) span.setAttribute("cohub.span_id", ids.spanId);
}

export function applyTraceResponseHeaders(headers: Headers, ids: TraceIdentifiers) {
  headers.set(REQUEST_ID_HEADER, ids.requestId);
  if (ids.traceId) headers.set(TRACE_ID_HEADER, ids.traceId);
  if (ids.spanId) headers.set(SPAN_ID_HEADER, ids.spanId);
  if (ids.traceparent) headers.set(TRACEPARENT_HEADER, ids.traceparent);
}

export function buildTraceHeaders(input: { requestId?: string | null } = {}): Record<string, string> {
  const requestId = getOrCreateRequestId(input.requestId);
  const carrier: Record<string, string> = { [REQUEST_ID_HEADER]: requestId };
  propagation.inject(context.active(), carrier);
  return carrier;
}

export function getTraceResponseHeaders(response: Response): TraceIdentifiers {
  const requestId = getOrCreateRequestId(response.headers.get(REQUEST_ID_HEADER));
  return {
    requestId,
    traceId: response.headers.get(TRACE_ID_HEADER),
    spanId: response.headers.get(SPAN_ID_HEADER),
    traceparent: response.headers.get(TRACEPARENT_HEADER),
  };
}

export function getCurrentRequestId(): string | null {
  return getRequestTraceContext()?.requestId ?? null;
}

export function getTraceId(): string | null {
  return trace.getActiveSpan()?.spanContext().traceId ?? null;
}
