#!/usr/bin/env tsx
import "dotenv/config";
import { asc, eq, gt } from "drizzle-orm";
import { spaces } from "@cohub/db";
import { db } from "../apps/api/src/db/index.js";
import { enqueueTask } from "../apps/api/src/tasks.js";

const args = new Map<string, string | true>();
for (let i = 2; i < process.argv.length; i += 1) {
  const arg = process.argv[i];
  if (!arg.startsWith("--")) continue;
  const key = arg.slice(2);
  const next = process.argv[i + 1];
  if (next && !next.startsWith("--")) {
    args.set(key, next);
    i += 1;
  } else {
    args.set(key, true);
  }
}

const dryRun = args.has("dry-run");
const limit = Number(args.get("limit") ?? 1000);
const pageSize = Number(args.get("page-size") ?? 100);
const spaceId = typeof args.get("space-id") === "string" ? args.get("space-id") as string : null;
const description = typeof args.get("description") === "string" ? args.get("description") as string : "Initialize checkpoint storage v2";

async function main() {
  let processed = 0;
  let cursor: string | null = null;
  while (processed < limit) {
    const rows = spaceId
      ? await db.select().from(spaces).where(eq(spaces.id, spaceId)).limit(1)
      : cursor
        ? await db.select().from(spaces).where(gt(spaces.id, cursor)).orderBy(asc(spaces.id)).limit(Math.min(pageSize, limit - processed))
        : await db.select().from(spaces).orderBy(asc(spaces.id)).limit(Math.min(pageSize, limit - processed));

    const page = rows;
    if (page.length === 0) break;

    for (const space of page) {
      processed += 1;
      cursor = space.id;
      if (dryRun) {
        console.log(`[dry-run] would enqueue save_checkpoint space=${space.id} name=${space.name}`);
        continue;
      }
      const { taskRunId } = await enqueueTask({
        type: "save_checkpoint",
        spaceId: space.id,
        userId: space.userUuid,
        data: { spaceId: space.id, description, reason: "checkpoint_storage_v2_rebuild" },
      });
      console.log(`enqueued save_checkpoint space=${space.id} taskRunId=${taskRunId}`);
      if (spaceId) return;
    }
    if (spaceId || page.length < pageSize) break;
  }
  console.log(`done processed=${processed} dryRun=${dryRun}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
