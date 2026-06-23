import type { Command } from "commander";
import { createClient } from "../client.js";
import { handleHttp, json as outJson, jsonRequested, table } from "../output.js";

function parseInteger(value: string, name: string, min: number): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed < min) {
    process.stderr.write(`\n  ✗ Invalid ${name}\n    ${name} must be an integer ≥ ${min}\n\n`);
    process.exit(1);
  }
  return parsed;
}

export function registerMe(program: Command): void {
  const meCmd = program.command("me").description("Account-level data across your spaces");

  meCmd
    .command("sessions")
    .alias("list-sessions")
    .description("List sessions you created across all spaces")
    .option("--limit <n>", "Maximum number of sessions (default 20)")
    .option("--cursor <cursor>", "Pagination cursor from a previous result")
    .option("--json", "Output as JSON")
    .action(async (opts: { limit?: string; cursor?: string; json?: boolean }) => {
      const client = createClient();
      try {
        const result = await client.user.listSessions({
          limit: opts.limit ? parseInteger(opts.limit, "limit", 1) : undefined,
          cursor: opts.cursor ?? null,
        });
        if (jsonRequested(opts)) return outJson(result);
        if (result.sessions.length === 0) {
          console.log("  (empty)");
          return;
        }
        table(result.sessions, [
          { key: "id", label: "ID" },
          { key: "spaceId", label: "Space" },
          { key: "title", label: "Title" },
          { key: "totalMessages", label: "Messages" },
          { key: "createdAt", label: "Created" },
        ]);
      } catch (e: unknown) {
        handleHttp(e);
      }
    });

  meCmd
    .command("usage [days]")
    .description("Your aggregated usage across all spaces (default: 30 days)")
    .option("--json", "Output as JSON")
    .action(async (days: string | undefined, opts: { json?: boolean }) => {
      const client = createClient();
      try {
        const usage = await client.user.getUsage(days ? parseInteger(days, "days", 1) : 30);
        if (jsonRequested(opts)) return outJson(usage);
        console.log("\n  Summary:");
        table([usage.summary], [
          { key: "totalTokens", label: "Tokens" },
          { key: "costTotal", label: "Cost ($)" },
          { key: "requestCount", label: "Requests" },
          { key: "successCount", label: "Success" },
          { key: "errorCount", label: "Errors" },
        ]);
      } catch (e: unknown) {
        handleHttp(e);
      }
    });
}
