import type { Command } from "commander";
import { createClient } from "../client.js";
import { table, json as outJson, jsonRequested, handleHttp } from "../output.js";

export function registerTasks(program: Command): void {
  const cmd = program.command("tasks", { hidden: true }).description("Task runs");

  cmd
    .command("ls")
    .alias("list")
    .description("List task runs")
    .option("--cron-job <id>", "Filter by cron job")
    .option("--space <id>", "Filter by space")
    .option("--json", "Output as JSON")
    .action(async (opts: { cronJob?: string; space?: string; json?: boolean }) => {
      const client = createClient();
      try {
        const filters: { cronJobId?: string; spaceId?: string } = {};
        if (opts.cronJob) filters.cronJobId = opts.cronJob;
        if (opts.space) filters.spaceId = opts.space;

        const result = await client.tasks.list(filters);
        if (jsonRequested(opts)) return outJson(result);
        if (result.runs.length === 0) return console.log("  (empty)");
        table(result.runs, [
          { key: "id", label: "ID" },
          { key: "taskType", label: "Type" },
          { key: "status", label: "Status" },
          { key: "createdAt", label: "Created" },
        ]);
      } catch (e: unknown) {
        handleHttp(e);
      }
    });

  cmd
    .command("get <id>")
    .description("Task run details")
    .option("--json", "Output as JSON")
    .action(async (id: string, opts: { json?: boolean }) => {
      const client = createClient();
      try {
        const result = await client.tasks.get(id);
        if (jsonRequested(opts)) return outJson(result);
        table([result.run], [
          { key: "id", label: "ID" },
          { key: "taskType", label: "Type" },
          { key: "status", label: "Status" },
          { key: "attemptCount", label: "Attempts" },
          { key: "createdAt", label: "Created" },
        ]);
      } catch (e: unknown) {
        handleHttp(e);
      }
    });

}
