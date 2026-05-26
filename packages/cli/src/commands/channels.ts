import type { Command } from "commander";
import { createClient } from "../client.js";
import { table, json as outJson, jsonRequested, ok, error, handleHttp } from "../output.js";

export function registerChannels(program: Command): void {
  const cmd = program.command("channels", { hidden: true }).description("Channel integrations");

  cmd
    .command("ls")
    .alias("list")
    .description("List channels")
    .option("--json", "Output as JSON")
    .action(async (opts: { json?: boolean }) => {
      const client = createClient();
      try {
        const items = await client.channels.list();
        if (jsonRequested(opts)) return outJson(items);
        if (items.length === 0) return console.log("  (empty)");
        table(items, [
          { key: "id", label: "ID" },
          { key: "provider", label: "Provider" },
          { key: "name", label: "Name" },
          { key: "status", label: "Status" },
        ]);
      } catch (e: unknown) {
        handleHttp(e);
      }
    });

  cmd
    .command("create")
    .description("Create a channel")
    .requiredOption("-p, --provider <provider>", "Channel provider")
    .requiredOption("-n, --name <name>", "Channel name")
    .option("--credentials <json>", "Credentials as JSON string")
    .option("--json", "Output as JSON")
    .action(async (opts: { provider: string; name: string; credentials?: string; json?: boolean }) => {
      let credentials: Record<string, unknown> = {};
      if (opts.credentials) {
        try {
          credentials = JSON.parse(opts.credentials);
        } catch {
          return error("Invalid JSON", "--credentials must be valid JSON");
        }
      }

      const client = createClient();
      try {
        const result = await client.channels.create({
          provider: opts.provider,
          name: opts.name,
          credentials,
        });
        if (jsonRequested(opts)) return outJson(result);
        ok("Channel created");
      } catch (e: unknown) {
        handleHttp(e);
      }
    });

  cmd
    .command("delete <id>")
    .description("Delete a channel")
    .action(async (id: string) => {
      const client = createClient();
      try {
        await client.channels.delete(id);
        ok(`Channel deleted: ${id}`);
      } catch (e: unknown) {
        handleHttp(e);
      }
    });
}
