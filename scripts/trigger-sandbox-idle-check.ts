#!/usr/bin/env tsx
import "dotenv/config";
import { inArray } from "drizzle-orm";
import { db } from "../apps/api/src/db/index.js";
import { spaceSandboxes } from "@cohub/db";
import { enqueueSandboxIdleCheck } from "../apps/api/src/sandbox-idle-scheduler.js";

const args = process.argv.slice(2);
const getArg = (name: string) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const hasFlag = (name: string) => args.includes(name);

const spaceId = getArg("--space-id");
const all = hasFlag("--all");
const limit = Math.max(1, Number.parseInt(getArg("--limit") ?? "100", 10) || 100);
const delaySeconds = Math.max(0, Number.parseInt(getArg("--delay-seconds") ?? "0", 10) || 0);

if (!spaceId && !all) {
  console.error("Usage: pnpm tsx scripts/trigger-sandbox-idle-check.ts --space-id <id> [--delay-seconds 0]");
  console.error("   or: pnpm tsx scripts/trigger-sandbox-idle-check.ts --all [--limit 100] [--delay-seconds 0]");
  process.exit(1);
}

const targets = spaceId
  ? [{ spaceId }]
  : await db
      .select({ spaceId: spaceSandboxes.spaceId })
      .from(spaceSandboxes)
      .where(inArray(spaceSandboxes.status, ["ready", "running"]))
      .limit(limit);

for (const target of targets) {
  await enqueueSandboxIdleCheck(target.spaceId, delaySeconds * 1000);
  console.log(JSON.stringify({ queued: true, spaceId: target.spaceId, delaySeconds }));
}

console.log(JSON.stringify({ ok: true, count: targets.length }));
