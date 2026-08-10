#!/usr/bin/env node
import { relaunchCli } from "./launcher.js";
import { ensureCliSelfUpdated } from "./self-update.js";

const argv = process.argv.slice(2);
const isVersionRequest = argv.some((arg) => arg === "-v" || arg === "--version");

let shouldRelaunch = false;
try {
  if (!isVersionRequest) {
    shouldRelaunch = await ensureCliSelfUpdated() !== "current";
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`cohub self-update failed: ${message}\n`);
  process.stderr.write("run with --version to skip self-update\n");
  process.exit(1);
}

if (shouldRelaunch) {
  const entrypoint = process.argv[1];
  if (!entrypoint) {
    process.stderr.write("cohub failed to locate its updated entrypoint\n");
    process.exit(1);
  }

  try {
    process.exitCode = await relaunchCli(entrypoint, argv);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`cohub failed to launch the updated CLI: ${message}\n`);
    process.exitCode = 1;
  }
} else {
  await import("./index.js");
}
