import type { Command } from "commander";
import { error } from "./output.js";

export function resolveSpace(program: Command): string {
  let current: Command | null = program;
  while (current) {
    const opts = current.opts() as Record<string, unknown>;
    if (typeof opts.space === "string" && opts.space.trim()) return opts.space.trim();
    current = current.parent ?? null;
  }

  const envSpace = process.env.COHUB_SPACE_ID?.trim();
  if (envSpace) return envSpace;

  return error("Missing required space", "Add -s, --space <id> or set COHUB_SPACE_ID.");
}
