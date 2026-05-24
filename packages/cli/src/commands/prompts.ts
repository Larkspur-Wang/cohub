import type { Command } from "commander";
import { createClient } from "../client.js";
import { table, json as outJson, handleHttp } from "../output.js";

export function registerPrompts(program: Command): void {
  const cmd = program.command("prompts").description("Prompt template management");

  cmd
    .command("ls")
    .alias("list")
    .description("List prompt templates")
    .option("--space <id>", "Filter by space")
    .option("--json", "Output as JSON")
    .action(async (opts: { space?: string; json?: boolean }) => {
      const client = createClient();
      try {
        const result = await client.prompts.list({ spaceId: opts.space });
        if (opts.json) return outJson(result);
        if (result.prompts.length === 0) return console.log("  (empty)");
        table(result.prompts, [
          { key: "name", label: "Name" },
          { key: "category", label: "Category" },
          { key: "description", label: "Description" },
        ]);
      } catch (e: unknown) {
        handleHttp(e);
      }
    });
}
