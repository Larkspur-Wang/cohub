import type { Command } from "commander";
import { createClient } from "../client.js";
import { table, json as outJson, ok, error, handleHttp } from "../output.js";

export function registerCronJobs(program: Command): void {
  const cmd = program.command("cron-jobs", { hidden: true }).description("Scheduled prompt jobs");

  cmd
    .command("ls [spaceId]")
    .alias("list")
    .description("List cron jobs")
    .option("--json", "Output as JSON")
    .action(async (spaceId: string | undefined, opts: { json?: boolean }) => {
      const client = createClient();
      try {
        const result = await client.cronJobs.list(spaceId);
        if (opts.json) return outJson(result);
        if (result.jobs.length === 0) return console.log("  (empty)");
        table(result.jobs, [
          { key: "id", label: "ID" },
          { key: "title", label: "Title" },
          { key: "cronExpression", label: "Schedule" },
          { key: "enabled", label: "Enabled" },
          { key: "spaceId", label: "Space" },
        ]);
      } catch (e: unknown) {
        handleHttp(e);
      }
    });


  cmd
    .command("delete <id>")
    .description("Delete a cron job")
    .action(async (id: string) => {
      const client = createClient();
      try {
        await client.cronJobs.delete(id);
        ok(`Cron job deleted: ${id}`);
      } catch (e: unknown) {
        handleHttp(e);
      }
    });

  cmd
    .command("toggle <id> <on|off>")
    .description("Enable or disable a cron job")
    .action(async (id: string, state: string) => {
      const enabled = state === "on";
      const client = createClient();
      try {
        await client.cronJobs.toggle(id, enabled);
        ok(`Cron job ${enabled ? "enabled" : "disabled"}: ${id}`);
      } catch (e: unknown) {
        handleHttp(e);
      }
    });

  cmd
    .command("runs <id>")
    .description("List cron job runs")
    .option("--json", "Output as JSON")
    .action(async (id: string, opts: { json?: boolean }) => {
      const client = createClient();
      try {
        const result = await client.cronJobs.runs(id);
        if (opts.json) return outJson(result);
        if (result.runs.length === 0) return console.log("  (empty)");
        table(result.runs, [
          { key: "id", label: "ID" },
          { key: "status", label: "Status" },
          { key: "startedAt", label: "Started" },
          { key: "finishedAt", label: "Finished" },
        ]);
      } catch (e: unknown) {
        handleHttp(e);
      }
    });
}
