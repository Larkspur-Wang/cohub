import { instrumentDrizzleClient } from "@kubiks/otel-drizzle";

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
