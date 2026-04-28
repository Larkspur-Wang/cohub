import { instrumentDrizzleClient } from "@kubiks/otel-drizzle";
import { context, SpanKind, SpanStatusCode, trace } from "@opentelemetry/api";

export type DbTimingOptions = {
  tracerName?: string;
  slowQueryThresholdMs?: number;
  onQuery?: (info: { durationMs: number; operation: string }) => void;
};

const formatDuration = (durationMs: number) => Math.round(durationMs * 10) / 10;

function getQueryOperation(args: unknown[]) {
  for (const arg of args) {
    if (typeof arg === "string") {
      const operation = arg.trim().split(/\s+/)[0]?.toLowerCase();
      if (operation) return operation;
    }
    if (Array.isArray(arg) && typeof arg[0] === "string") {
      const first = arg.join(" ").trim().split(/\s+/)[0]?.toLowerCase();
      if (first) return first;
    }
    if (arg && typeof arg === "object" && "strings" in arg && Array.isArray((arg as { strings?: unknown }).strings)) {
      const first = (arg as { strings: string[] }).strings.join(" ").trim().split(/\s+/)[0]?.toLowerCase();
      if (first) return first;
    }
  }
  return "query";
}

export function instrumentPostgresClient<T extends object>(client: T, options?: DbTimingOptions): T {
  const tracer = trace.getTracer(options?.tracerName ?? "cohub-db");
  const slowQueryThresholdMs = options?.slowQueryThresholdMs ?? Number(process.env.DB_SLOW_QUERY_THRESHOLD_MS ?? 100);
  const callable = typeof client === "function" ? (client as unknown as (...args: unknown[]) => Promise<unknown>) : null;
  if (!callable) return client;

  const wrapped = (async (...args: unknown[]) => {
    const parentSpan = trace.getActiveSpan();
    const operation = getQueryOperation(args);
    const span = parentSpan
      ? tracer.startSpan("db.postgres.query", {
        kind: SpanKind.CLIENT,
        attributes: {
          "db.system.name": "postgresql",
          "db.operation.name": operation,
        },
      })
      : null;
    const startedAt = performance.now();

    return context.with(span ? trace.setSpan(context.active(), span) : context.active(), async () => {
      try {
        return await callable(...args);
      } catch (error) {
        span?.recordException(error instanceof Error ? error : new Error(String(error)));
        span?.setStatus({ code: SpanStatusCode.ERROR, message: String(error) });
        throw error;
      } finally {
        const durationMs = performance.now() - startedAt;
        span?.setAttribute("db.query.duration_ms", formatDuration(durationMs));
        options?.onQuery?.({ durationMs, operation });
        if (durationMs >= slowQueryThresholdMs) {
          trace.getActiveSpan()?.addEvent("db.slow_query", {
            "db.operation.name": operation,
            "db.query.duration_ms": formatDuration(durationMs),
          });
        }
        span?.end();
      }
    });
  }) as unknown as T;

  return new Proxy(wrapped, {
    get(_target, prop, receiver) {
      return Reflect.get(client, prop, receiver);
    },
    set(_target, prop, value, receiver) {
      return Reflect.set(client, prop, value, receiver);
    },
    apply(_target, thisArg, argArray) {
      return Reflect.apply(wrapped as unknown as (...args: unknown[]) => unknown, thisArg, argArray);
    },
  });
}

/**
 * Initialize Drizzle ORM tracing for a service.
 * Call this after creating your Drizzle client but before executing any queries.
 *
 * @param db - The Drizzle database client instance
 * @param options - Optional configuration
 */
export function initDrizzleTracing<T>(
  db: T,
  options?: {
    /** Database system identifier. Defaults to "postgresql". */
    dbSystem?: string;
    /** Database name for spans. */
    dbName?: string;
    /** Whether to capture full SQL query text. Defaults to true. */
    captureQueryText?: boolean;
    /** Max SQL text length. Defaults to 1000. */
    maxQueryTextLength?: number;
    /** Database server hostname. */
    peerName?: string;
    /** Database server port. */
    peerPort?: number;
  },
): T {
  // The library uses duck-typing (DrizzleDbLike) internally; we pass the
  // client through so callers keep their original type.
  instrumentDrizzleClient(db as Parameters<typeof instrumentDrizzleClient>[0], {
    dbSystem: options?.dbSystem ?? "postgresql",
    dbName: options?.dbName,
    captureQueryText: options?.captureQueryText ?? true,
    maxQueryTextLength: options?.maxQueryTextLength ?? 1000,
    peerName: options?.peerName,
    peerPort: options?.peerPort,
  });
  return db;
}
