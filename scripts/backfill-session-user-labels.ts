import "dotenv/config";
import { config as loadDotenv } from "dotenv";
loadDotenv({ path: "apps/api/.env", override: false });

import { and, asc, eq, gt, or } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@cohub/db";
import { assignSessionParticipantSystemLabels } from "@cohub/core/labels/session-user";
import { readSessionParticipantUserUuids } from "@cohub/core/sessions";

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

type Cursor = {
  createdAt: Date;
  id: string;
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

const normalizeUserUuids = (values: Array<string | null | undefined>) => {
  const seen = new Set<string>();
  const userUuids: string[] = [];
  for (const value of values) {
    const normalized = value?.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    userUuids.push(normalized);
  }
  return userUuids;
};

function buildFilters(args: Args, cursor: Cursor | null) {
  const filters = [];
  if (args.spaceId) filters.push(eq(schema.spaceSessions.spaceId, args.spaceId));
  if (args.sessionId) filters.push(eq(schema.spaceSessions.id, args.sessionId));
  if (cursor) {
    filters.push(or(
      gt(schema.spaceSessions.createdAt, cursor.createdAt),
      and(eq(schema.spaceSessions.createdAt, cursor.createdAt), gt(schema.spaceSessions.id, cursor.id)),
    ));
  }
  return filters;
}

async function loadBatch(args: Args, cursor: Cursor | null, remainingLimit: number | null) {
  const filters = buildFilters(args, cursor);
  const limit = remainingLimit ? Math.min(args.batchSize, remainingLimit) : args.batchSize;
  return db
    .select()
    .from(schema.spaceSessions)
    .where(filters.length > 0 ? and(...filters) : undefined)
    .orderBy(asc(schema.spaceSessions.createdAt), asc(schema.spaceSessions.id))
    .limit(limit);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  let cursor: Cursor | null = null;
  let sessionsScanned = 0;
  let sessionsWithParticipants = 0;
  let labelsTouched = 0;
  let failures = 0;

  while (true) {
    const remainingLimit = args.maxSessions ? args.maxSessions - sessionsScanned : null;
    if (remainingLimit !== null && remainingLimit <= 0) break;
    const sessions = await loadBatch(args, cursor, remainingLimit);
    if (sessions.length === 0) break;

    for (const session of sessions) {
      sessionsScanned += 1;
      const userUuids = normalizeUserUuids([
        session.userUuid,
        ...readSessionParticipantUserUuids(session.meta),
      ]);
      if (userUuids.length === 0) continue;
      sessionsWithParticipants += 1;
      if (!args.write) {
        labelsTouched += userUuids.length;
        continue;
      }
      try {
        const labelIds = await assignSessionParticipantSystemLabels({
          db,
          spaceId: session.spaceId,
          sessionId: session.id,
          userUuids,
        });
        labelsTouched += labelIds.length;
      } catch (error) {
        failures += 1;
        console.warn("[backfill-session-user-labels] failed", {
          sessionId: session.id,
          spaceId: session.spaceId,
          error,
        });
      }
    }

    const lastSession = sessions.at(-1);
    if (!lastSession?.createdAt) break;
    cursor = {
      createdAt: lastSession.createdAt instanceof Date ? lastSession.createdAt : new Date(lastSession.createdAt),
      id: lastSession.id,
    };
  }

  console.log(JSON.stringify({
    mode: args.write ? "write" : "dry-run",
    batchSize: args.batchSize,
    maxSessions: args.maxSessions,
    sessionsScanned,
    sessionsWithParticipants,
    labelsTouched,
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
