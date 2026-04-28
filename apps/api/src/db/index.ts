import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema-v2.js";
import { initDrizzleTracing, instrumentPostgresClient } from "@cohub/tracing/db";
import { trace } from "@opentelemetry/api";

// connection string can be defined in .env
const connectionString =
  process.env.DATABASE_URL ||
  "postgres://postgres:postgres@localhost:5432/cohub";

const formatDuration = (durationMs: number) => Math.round(durationMs * 10) / 10;

const recordDbTiming = (durationMs: number, operation: string) => {
  const activeSpan = trace.getActiveSpan();
  if (!activeSpan) return;
  const root = activeSpan;
  root.addEvent("api.db.query", {
    "db.operation.name": operation,
    "db.query.duration_ms": formatDuration(durationMs),
  });
};

// Disable prefetch as it is not supported for "Transaction" pool mode
const client = instrumentPostgresClient(postgres(connectionString, { prepare: false }), {
  tracerName: "cohub-api",
  onQuery: ({ durationMs, operation }) => recordDbTiming(durationMs, operation),
});
export const db = initDrizzleTracing(
  drizzle(client, { schema }),
  {
    dbSystem: "postgresql",
    dbName: "cohub",
  },
);
