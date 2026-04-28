import "dotenv/config";
import { eq, isNull, or, sql } from "drizzle-orm";
import { db } from "../apps/api/src/db/index.js";
import { spaceSandboxes } from "../apps/api/src/db/schema-v2.js";
import { config, sessionsNamespace } from "../apps/api/src/config.js";
import { reconcileSandboxPublicNetwork, getSandboxPublicEndpoints } from "../apps/api/src/sandbox-public-network.js";
import { mergeSpaceSandboxMeta } from "../apps/api/src/space-sandboxes.js";

const spaceIdArg = (() => {
  const idx = process.argv.indexOf("--space-id");
  return idx !== -1 ? process.argv[idx + 1] : null;
})();

async function main() {
  console.log(`[Backfill] env=${config.env} namespace=${sessionsNamespace}`);
  if (spaceIdArg) {
    console.log(`[Backfill] targeting single spaceId=${spaceIdArg}`);
  } else {
    console.log(`[Backfill] scanning all ready sandboxes missing publicNetworkStatus`);
  }

  const whereClauses = spaceIdArg
    ? eq(spaceSandboxes.spaceId, spaceIdArg)
    : or(
        isNull(spaceSandboxes.meta),
        sql`NOT (${spaceSandboxes.meta} ? 'publicNetworkStatus')`,
      );

  const candidates = await db
    .select({
      spaceId: spaceSandboxes.spaceId,
      status: spaceSandboxes.status,
    })
    .from(spaceSandboxes)
    .where(whereClauses);

  // When targeting a specific space, process it regardless of status filter
  const sandboxes = spaceIdArg
    ? candidates
    : candidates.filter((r) => r.status === "ready");

  if (sandboxes.length === 0) {
    console.log("[Backfill] Nothing to do.");
    return;
  }

  console.log(`[Backfill] Found ${sandboxes.length} sandbox(es) to process.\n`);

  let success = 0;
  let failed = 0;

  for (const row of sandboxes) {
    const { spaceId, status } = row;
    process.stdout.write(`  ${spaceId} (status=${status}) ... `);
    try {
      await reconcileSandboxPublicNetwork(spaceId);
      await mergeSpaceSandboxMeta(spaceId, {
        publicNetworkStatus: "ready",
        publicNetworkLastError: null,
        publicNetworkReconciledAt: new Date().toISOString(),
        publicEndpoints: getSandboxPublicEndpoints(spaceId),
      });
      console.log("✓");
      success++;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.log(`✗ ${msg}`);
      failed++;
      try {
        await mergeSpaceSandboxMeta(spaceId, {
          publicNetworkStatus: "error",
          publicNetworkLastError: msg,
          publicEndpoints: getSandboxPublicEndpoints(spaceId),
        });
      } catch {
        // best effort to record error
      }
    }
  }

  console.log(`\n[Backfill] Done: ${success} succeeded, ${failed} failed.`);
}

main().catch((error) => {
  console.error("[Backfill] Fatal error:", error);
  process.exit(1);
});
