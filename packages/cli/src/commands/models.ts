import type { Command } from "commander";
import { createClient } from "../client.js";
import { table, json as outJson, jsonRequested, error, handleHttp, type Row } from "../output.js";

export function registerModels(program: Command): void {
  const cmd = program
    .command("models")
    .description("List available LLM and multimodal models")
    .addHelpText("after", `

Examples:
  cohub models ls
  cohub models ls --model-type multimodal
  cohub models ls --model-type multimodal --json
`);

  cmd
    .command("ls")
    .alias("list")
    .description("List available models")
    .option("--model-type <type>", "Model type: llm | multimodal", "llm")
    .option("--json", "Output as JSON")
    .action(async (opts: { modelType?: string; json?: boolean }) => {
      const client = createClient();
      try {
        if (opts.modelType === "multimodal") {
          const response = await client.models.listMultimodal();
          if (jsonRequested(opts)) return outJson(response);
          table(response.models as unknown as Row[], [
            { key: "model", label: "Model" },
            { key: "title", label: "Title" },
            { key: "description", label: "Description" },
          ]);
          return;
        }

        if (opts.modelType && opts.modelType !== "llm") {
          return error("Invalid model type", "Use --model-type llm or --model-type multimodal");
        }

        const catalog = await client.models.list();
        if (jsonRequested(opts)) return outJson(catalog);

        // catalog is Record<provider, ModelCatalogEntry[]>
        for (const [provider, entries] of Object.entries(catalog)) {
          console.log(`\n  ${provider}`);
          console.log(`  ${"─".repeat(provider.length)}`);
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
