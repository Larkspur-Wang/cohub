import type { GlobalSearchResult } from "@neta-art/cohub";
import type { Command } from "commander";
import { resolveToken } from "../auth.js";
import { createClient } from "../client.js";
import { table, json as outJson, error, handleHttp, type Row } from "../output.js";

const DEFAULT_LIMIT = 20;
const MAX_TITLE_LENGTH = 72;
const MAX_CONTEXT_LENGTH = 42;

function clampLimit(value: string | undefined): number {
  const parsed = Number(value ?? DEFAULT_LIMIT);
  if (!Number.isFinite(parsed)) return DEFAULT_LIMIT;
  return Math.min(Math.max(Math.floor(parsed), 1), 50);
}

function truncate(value: string | null | undefined, maxLength: number): string {
  const text = (value ?? "").replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function contextFor(item: GlobalSearchResult): string {
  if (item.type === "space") return item.spaceName ?? "";
  if (item.type === "session") return item.spaceName ?? "";
  return item.sessionTitle || item.spaceName || "";
}

function rowsFor(items: GlobalSearchResult[]): Row[] {
  return items.map((item) => ({
    type: item.type,
    title: truncate(item.title || item.excerpt, MAX_TITLE_LENGTH),
    context: truncate(contextFor(item), MAX_CONTEXT_LENGTH),
    match: item.matchedField,
    updated: item.updatedAt ? item.updatedAt.slice(0, 10) : "",
    href: item.href,
  }));
}

export function registerSearch(program: Command): void {
  program
    .command("search")
    .description("Search spaces, chats, and turns")
    .argument("<query>", "Search query")
    .option("--limit <n>", "Maximum results, 1-50", String(DEFAULT_LIMIT))
    .option("--json", "Output as JSON")
    .addHelpText("after", `

Examples:
  cohub search "release notes"
  cohub search "failing tests" --limit 10
  cohub search "design review" --json
`)
    .action(async (query: string, opts: { limit?: string; json?: boolean }) => {
      const token = resolveToken();
      if (!token) return error("Not authenticated", "Run 'cohub auth login <token>'");

      const client = createClient(token);
      try {
        const result = await client.search.query({ q: query, limit: clampLimit(opts.limit) });
        if (opts.json) return outJson(result);

        if (result.degraded) {
          process.stderr.write("  Search is temporarily degraded; results may be incomplete.\n");
        }

        table(rowsFor(result.items), [
          { key: "type", label: "Type" },
          { key: "title", label: "Title" },
          { key: "context", label: "Context" },
          { key: "match", label: "Match" },
          { key: "updated", label: "Updated" },
          { key: "href", label: "Href" },
        ]);
      } catch (e: unknown) {
        handleHttp(e);
      }
    });
}
