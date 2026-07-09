import "dotenv/config";
import { config as loadDotenv } from "dotenv";
loadDotenv({ path: "apps/api/.env", override: false });

import { and, asc, eq, gt, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@cohub/db";
import { assignSessionChannelSystemLabel } from "@cohub/core/labels/session-channel";

const connectionString = process.env.DATABASE_URL || "postgres://postgres:postgres@localhost:5432/cohub";
const dbClient = postgres(connectionString, { prepare: false });
const db = drizzle(dbClient, { schema });

const DEFAULT_BATCH_SIZE = 500;
const MAX_BATCH_SIZE = 5_000;

type Args = {
  write: boolean;
  spaceId: string | null;
  sessionId: string | null;
  batchSize: number;
  maxSessions: number | null;
};

/** Cursor on binding id only — createdAt is nullable and unsafe for pagination. */
type Cursor = {
  id: string;
};

type BindingRow = {
  bindingId: string;
  spaceId: string;
  sessionId: string;
  spaceChannelId: string;
  channelId: string | null;
  provider: string;
  lastMessageAt: Date | null;
  updatedAt: Date | null;
  createdAt: Date | null;
};

function parseArgs(rawArgv: string[]): Args {
  const argv = rawArgv.filter((arg) => arg !== "--");
  const readValue = (name: string) => {
    const index = argv.indexOf(name);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  const batchSize = Math.min(Math.max(Number(readValue("--batch-size") ?? readValue("--limit") ?? DEFAULT_BATCH_SIZE), 1), MAX_BATCH_SIZE);
  const maxSessionsValue = readValue("--max-sessions");
  return {
    write: argv.includes("--write"),
    spaceId: readValue("--space-id") ?? null,
    sessionId: readValue("--session-id") ?? null,
    batchSize,
    maxSessions: maxSessionsValue ? Math.max(Number(maxSessionsValue), 1) : null,
  };
}

function buildFilters(args: Args, cursor: Cursor | null) {
  const filters = [
    or(
      sql`${schema.spaceSessionBindings.status} is null`,
      eq(schema.spaceSessionBindings.status, "active"),
    ),
  ];
  if (args.spaceId) filters.push(eq(schema.spaceSessionBindings.spaceId, args.spaceId));
  if (args.sessionId) filters.push(eq(schema.spaceSessionBindings.spaceSessionId, args.sessionId));
  if (cursor) filters.push(gt(schema.spaceSessionBindings.id, cursor.id));
  return filters;
}

async function loadBatch(args: Args, cursor: Cursor | null) {
  const filters = buildFilters(args, cursor);
  return db
    .select({
      bindingId: schema.spaceSessionBindings.id,
      spaceId: schema.spaceSessionBindings.spaceId,
      sessionId: schema.spaceSessionBindings.spaceSessionId,
      spaceChannelId: schema.spaceSessionBindings.spaceChannelId,
      channelId: schema.spaceChannels.channelId,
      provider: schema.spaceSessionBindings.provider,
      lastMessageAt: schema.spaceSessionBindings.lastMessageAt,
      updatedAt: schema.spaceSessionBindings.updatedAt,
      createdAt: schema.spaceSessionBindings.createdAt,
    })
    .from(schema.spaceSessionBindings)
    .leftJoin(
      schema.spaceChannels,
      eq(schema.spaceChannels.id, schema.spaceSessionBindings.spaceChannelId),
    )
    .where(and(...filters))
    .orderBy(asc(schema.spaceSessionBindings.id))
    .limit(args.batchSize);
}

function bindingRecency(row: BindingRow) {
  const stamp = row.lastMessageAt ?? row.updatedAt ?? row.createdAt;
  return stamp instanceof Date ? stamp.getTime() : stamp ? new Date(stamp).getTime() : 0;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  let cursor: Cursor | null = null;
  let bindingsScanned = 0;
  let sessionsLabeled = 0;
  let skippedMissingChannel = 0;
  let failures = 0;
  // Scan all pages first so multi-binding sessions keep the most recent channel.
  const bestBySession = new Map<string, BindingRow>();

  while (true) {
    const rows = (await loadBatch(args, cursor)) as BindingRow[];
    if (rows.length === 0) break;

    for (const row of rows) {
      bindingsScanned += 1;
      if (!row.channelId) {
        skippedMissingChannel += 1;
        continue;
      }
      const existing = bestBySession.get(row.sessionId);
      if (!existing || bindingRecency(row) >= bindingRecency(existing)) {
        bestBySession.set(row.sessionId, row);
      }
    }

    const lastRow = rows.at(-1);
    if (!lastRow) break;
    cursor = { id: lastRow.bindingId };
    if (rows.length < args.batchSize) break;
  }

  const targets = [...bestBySession.values()];
  const limited = args.maxSessions ? targets.slice(0, args.maxSessions) : targets;

  for (const row of limited) {
    if (!row.channelId) continue;
    if (!args.write) {
      sessionsLabeled += 1;
      continue;
    }
    try {
      await assignSessionChannelSystemLabel({
        db,
        spaceId: row.spaceId,
        sessionId: row.sessionId,
        channelId: row.channelId,
        spaceChannelId: row.spaceChannelId,
        provider: row.provider,
      });
      sessionsLabeled += 1;
    } catch (error) {
      failures += 1;
      console.warn("[backfill-session-channel-labels] failed", {
        sessionId: row.sessionId,
        spaceId: row.spaceId,
        channelId: row.channelId,
        error,
      });
    }
  }

  console.log(JSON.stringify({
    mode: args.write ? "write" : "dry-run",
    batchSize: args.batchSize,
    maxSessions: args.maxSessions,
    bindingsScanned,
    sessionsSelected: limited.length,
    sessionsLabeled,
    skippedMissingChannel,
    failures,
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await dbClient.end({ timeout: 5 }).catch(() => undefined);
  });
