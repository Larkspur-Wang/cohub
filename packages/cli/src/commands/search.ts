import type { GlobalSearchResult, GlobalSearchType } from "@neta-art/cohub";
import type { Command } from "commander";
import { createClient } from "../client.js";
import { table, json as outJson, error, handleHttp, type Row } from "../output.js";

const DEFAULT_LIMIT = 20;
const MAX_TITLE_LENGTH = 72;
const MAX_CONTEXT_LENGTH = 42;

const SEARCH_TYPES = new Set<GlobalSearchType>(["turn", "session", "space"]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type SearchCliOptions = {
  limit?: string;
  types?: string;
  spaceId?: string;
  json?: boolean;
};

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
  const owner = item.ownerProfile;
  if (owner?.username) return `@${owner.username}`;
  if (owner?.displayName) return owner.displayName;
  return item.href;
}

function parseTypes(value: string | undefined): GlobalSearchType[] | undefined {
  const types = value
    ?.split(",")
    .map((type) => type.trim())
    .filter(Boolean);
  if (!types?.length) return undefined;
  const invalidType = types.find((type) => !SEARCH_TYPES.has(type as GlobalSearchType));
  if (invalidType) throw new Error(`Invalid search type: ${invalidType}`);
  return [...new Set(types)] as GlobalSearchType[];
}

function parseSearchInput(opts: SearchCliOptions) {
  const types = parseTypes(opts.types);
  const spaceId = opts.spaceId?.trim();
  if (spaceId && !UUID_PATTERN.test(spaceId)) throw new Error("Invalid space id");
  return { types, spaceId: spaceId || undefined };
}

function rowsFor(items: GlobalSearchResult[]): Row[] {
  return items.map((item) => ({
    type: item.type,
    title: truncate(item.title, MAX_TITLE_LENGTH),
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
    .option("--types <types>", "Comma-separated result types: turn,session,space")
    .option("--space-id <id>", "Limit search to a space")
    .option("--json", "Output as JSON")
    .addHelpText("after", `

Examples:
  cohub search "release notes"
  cohub search "failing tests" --limit 10
  cohub search "bug" --types turn,session --space-id <spaceId>
  cohub search "design review" --json
`)
    .action(async (query: string, opts: SearchCliOptions) => {
      const client = createClient();
      try {
        const input = parseSearchInput(opts);
        const result = await client.search.query({
          q: query,
          limit: clampLimit(opts.limit),
          types: input.types,
          spaceId: input.spaceId,
        });
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
        if (e instanceof Error && (e.message === "Invalid space id" || e.message.startsWith("Invalid search type:"))) {
          return error(e.message);
        }
        handleHttp(e);
      }
    });
}
