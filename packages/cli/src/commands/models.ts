import type { Command } from "commander";
import { resolveToken } from "../auth.js";
import { createClient } from "../client.js";
import { table, json as outJson, error, handleHttp, type Row } from "../output.js";

export function registerModels(program: Command): void {
  const cmd = program.command("models").description("Model management");

  cmd
    .command("ls")
    .alias("list")
    .description("List available models")
    .option("--json", "Output as JSON")
    .action(async (opts: { json?: boolean }) => {
      const token = resolveToken();
      if (!token) return error("Not authenticated", "Run 'cohub auth login <token>'");

      const client = createClient(token);
      try {
        const catalog = await client.models.list();
        if (opts.json) return outJson(catalog);

        // catalog is Record<provider, ModelCatalogEntry[]>
        for (const [provider, entries] of Object.entries(catalog)) {
          console.log(`\n  ${provider}`);
          console.log("  " + "─".repeat(provider.length));
          table(entries as Row[], [
            { key: "id", label: "ID" },
            { key: "provider", label: "Provider" },
          ]);
        }
      } catch (e: unknown) {
        handleHttp(e);
      }
    });
}
