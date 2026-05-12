#!/usr/bin/env node
import { Command } from "commander";
import { readFileSync } from "node:fs";
import { registerAuth } from "./commands/auth.js";
import { registerChannels } from "./commands/channels.js";
import { registerCronJobs } from "./commands/cron-jobs.js";
import { registerGenerations } from "./commands/generations.js";
import { registerModels } from "./commands/models.js";
import { registerPrompts } from "./commands/prompts.js";
import { registerSessionAccess } from "./commands/session-access.js";
import { registerSpaces } from "./commands/spaces.js";
import { registerTasks } from "./commands/tasks.js";

const VERSION = (() => {
  try {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf-8"));
    return pkg.version as string;
  } catch {
    return "1.0.0";
  }
})();

const program = new Command("cohub");

program
  .version(VERSION)
  .description("CLI for Cohub — spaces, sessions, and agent collaboration.")
  .option("-s, --space <id>", "Target space ID")
  .option("--json", "Output as JSON")
  .helpOption("-h, --help", "Show help");

registerAuth(program);
registerSpaces(program);
registerChannels(program);
registerGenerations(program);
registerModels(program);
registerPrompts(program);
registerTasks(program);
registerCronJobs(program);
registerSessionAccess(program);

program.parse();
