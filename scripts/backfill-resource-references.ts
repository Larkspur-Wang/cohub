import "dotenv/config";
import { config as loadDotenv } from "dotenv";
loadDotenv({ path: "apps/api/.env", override: false });

import { asc, eq, gt, inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@cohub/db";
import {
  checkpointForkReference,
  extractTurnReferences,
  modReference,
  sessionForkReference,
  spaceForkReference,
  writeReferences,
  type ReferenceInput,
} from "@cohub/core/references";
import type { ContentBlock } from "@cohub/protocol/core";

/**
 * Backfill / rebuild the resource_references index from source tables.
 *
 * Source tables remain the sole source of truth; this index is fully
 * reconstructable at any time. The script is idempotent (writeReferences
 * upserts by identity) and safe to re-run, so it doubles as disaster recovery
 * when live double-writes miss an event.
 *
 * Usage:
 *   tsx scripts/backfill-resource-references.ts [--batch-size N] [--dry-run] [--reset]
 *
 *   --reset  Truncate first for a true rebuild (drops references whose source
 *            relationship no longer exists). Without it, runs as idempotent upsert.
 */

const connectionString =
  process.env.DATABASE_URL || "postgres://postgres:postgres@localhost:5432/cohub";
const dbClient = postgres(connectionString, { prepare: false });
const db = drizzle(dbClient, { schema });

const DEFAULT_BATCH_SIZE = 500;
const MAX_BATCH_SIZE = 5_000;

type Args = {
  batchSize: number;
  dryRun: boolean;
  reset: boolean;
};

function parseArgs(rawArgv: string[]): Args {
  const argv = rawArgv.filter((arg) => arg !== "--");
  const readValue = (name: string) => {
    const index = argv.indexOf(name);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  const batchSize = Math.min(
    Math.max(Number(readValue("--batch-size") ?? DEFAULT_BATCH_SIZE), 1),
    MAX_BATCH_SIZE,
  );
  return { batchSize, dryRun: argv.includes("--dry-run"), reset: argv.includes("--reset") };
}

const asContentBlocks = (value: unknown): ContentBlock[] | null =>
  Array.isArray(value) ? (value as ContentBlock[]) : null;

async function flush(references: ReferenceInput[], dryRun: boolean) {
  if (references.length === 0) return 0;
  if (!dryRun) await writeReferences(db, references);
  return references.length;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  console.log(
    `[backfill-references] start batchSize=${args.batchSize} dryRun=${args.dryRun} reset=${args.reset}`,
  );

  // With --reset, truncate first so the run is a true rebuild: references whose
  // underlying relationship no longer exists (e.g. an unmounted mod) are dropped
  // rather than lingering as stale rows. Without it, the run is an idempotent
  // upsert that only adds/refreshes.
  if (args.reset && !args.dryRun) {
    await db.execute(sql`TRUNCATE TABLE ${schema.resourceReferences}`);
    console.log("[backfill-references] truncated resource_references");
  }

  const totals = {
    sessionFork: 0,
    spaceFork: 0,
    checkpointFork: 0,
    mod: 0,
    turn: 0,
  };

  // --- Structural: session forks ---
  {
    let cursor: string | null = null;
    for (;;) {
      const rows = await db
        .select()
        .from(schema.sessionForks)
        .where(cursor ? gt(schema.sessionForks.id, cursor) : undefined)
        .orderBy(asc(schema.sessionForks.id))
        .limit(args.batchSize);
      if (rows.length === 0) break;
      const refs = rows.map((row) =>
        sessionForkReference({
          spaceId: row.spaceId,
          parentSessionId: row.parentSessionId,
          childSessionId: row.childSessionId,
          anchorTurnId: row.anchorTurnId,
          createdBy: row.createdBy,
        }),
      );
      totals.sessionFork += await flush(refs, args.dryRun);
      cursor = rows[rows.length - 1]?.id ?? null;
      if (rows.length < args.batchSize) break;
    }
  }

  // --- Structural: space forks (spaces with a base checkpoint) ---
  {
    let cursor: string | null = null;
    for (;;) {
      const rows = await db
        .select({
          id: schema.spaces.id,
          baseCheckpointId: schema.spaces.baseCheckpointId,
        })
        .from(schema.spaces)
        .where(cursor ? gt(schema.spaces.id, cursor) : undefined)
        .orderBy(asc(schema.spaces.id))
        .limit(args.batchSize);
      if (rows.length === 0) break;
      const refs = rows
        .filter((row) => row.baseCheckpointId)
        .map((row) =>
          spaceForkReference({
            spaceId: row.id,
            baseCheckpointId: row.baseCheckpointId as string,
          }),
        );
      totals.spaceFork += await flush(refs, args.dryRun);
      cursor = rows[rows.length - 1]?.id ?? null;
      if (rows.length < args.batchSize) break;
    }
  }

  // --- Structural: checkpoint forks ---
  {
    let cursor: string | null = null;
    for (;;) {
      const rows = await db
        .select({
          id: schema.checkpoints.id,
          spaceId: schema.checkpoints.spaceId,
          parentCheckpointId: schema.checkpoints.parentCheckpointId,
          rootCheckpointId: schema.checkpoints.rootCheckpointId,
        })
        .from(schema.checkpoints)
        .where(cursor ? gt(schema.checkpoints.id, cursor) : undefined)
        .orderBy(asc(schema.checkpoints.id))
        .limit(args.batchSize);
      if (rows.length === 0) break;
      const refs = rows
        .filter((row) => row.parentCheckpointId)
        .map((row) =>
          checkpointForkReference({
            spaceId: row.spaceId,
            checkpointId: row.id,
            parentCheckpointId: row.parentCheckpointId as string,
            rootCheckpointId: row.rootCheckpointId,
          }),
        );
      totals.checkpointFork += await flush(refs, args.dryRun);
      cursor = rows[rows.length - 1]?.id ?? null;
      if (rows.length < args.batchSize) break;
    }
  }

  // --- Structural: mods ---
  {
    let cursor: string | null = null;
    for (;;) {
      const rows = await db
        .select()
        .from(schema.spaceMods)
        .where(cursor ? gt(schema.spaceMods.id, cursor) : undefined)
        .orderBy(asc(schema.spaceMods.id))
        .limit(args.batchSize);
      if (rows.length === 0) break;
      const refs = rows.map((row) =>
        modReference({
          spaceId: row.spaceId,
          modSpaceId: row.modSpaceId,
          mountSlug: row.mountSlug,
        }),
      );
      totals.mod += await flush(refs, args.dryRun);
      cursor = rows[rows.length - 1]?.id ?? null;
      if (rows.length < args.batchSize) break;
    }
  }

  // --- Turn-derived: mentions, tool calls, agent file access ---
  {
    let cursor: string | null = null;
    for (;;) {
      const rows = await db
        .select({
          id: schema.sessionTurns.id,
          sessionId: schema.sessionTurns.sessionId,
          userContent: schema.sessionTurns.userContent,
          userText: schema.sessionTurns.userText,
          assistantContent: schema.sessionTurns.assistantContent,
          spaceId: schema.spaceSessions.spaceId,
        })
        .from(schema.sessionTurns)
        .innerJoin(
          schema.spaceSessions,
          eq(schema.sessionTurns.sessionId, schema.spaceSessions.id),
        )
        .where(cursor ? gt(schema.sessionTurns.id, cursor) : undefined)
        .orderBy(asc(schema.sessionTurns.id))
        .limit(args.batchSize);
      if (rows.length === 0) break;
      // Aggregate assistant content across all messages in each turn so tool
      // calls from intermediate steps are not lost (matches the live indexer).
      const turnIds = rows.map((row) => row.id);
      const messageRows = await db
        .select({
          turnId: sql<string>`${schema.sessionMessages.meta}->>'turnId'`,
          role: schema.sessionMessages.role,
          content: schema.sessionMessages.content,
        })
        .from(schema.sessionMessages)
        .where(
          inArray(sql`${schema.sessionMessages.meta}->>'turnId'`, turnIds),
        );
      const assistantContentByTurn = new Map<string, ContentBlock[]>();
      for (const message of messageRows) {
        if (message.role !== "assistant" || !message.turnId) continue;
        const blocks = asContentBlocks(message.content);
        if (!blocks) continue;
        const existing = assistantContentByTurn.get(message.turnId);
        if (existing) existing.push(...blocks);
        else assistantContentByTurn.set(message.turnId, [...blocks]);
      }
      const refs: ReferenceInput[] = [];
      for (const row of rows) {
        refs.push(
          ...extractTurnReferences({
            spaceId: row.spaceId,
            sessionId: row.sessionId,
            turnId: row.id,
            userContent: asContentBlocks(row.userContent),
            userText: row.userText,
            assistantContent:
              assistantContentByTurn.get(row.id) ?? asContentBlocks(row.assistantContent),
          }),
        );
      }
      totals.turn += await flush(refs, args.dryRun);
      cursor = rows[rows.length - 1]?.id ?? null;
      if (rows.length < args.batchSize) break;
    }
  }

  console.log("[backfill-references] done", totals);
  await dbClient.end();
}

main().catch(async (error) => {
  console.error("[backfill-references] failed", error);
  await dbClient.end();
  process.exit(1);
});
