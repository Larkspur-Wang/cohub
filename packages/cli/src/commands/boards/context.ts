import type { Command } from "commander";
import { createClient } from "../../client.js";
import { resolveBoardId } from "../../board-command-support.js";
import { json, jsonRequested, ok } from "../../output.js";
import { resolveSpace } from "../../space.js";

export type JsonOptions = { json?: boolean };

export function withJson(command: Command): Command {
  return command.option("--json", "Output as JSON");
}

export function finite(value: string | undefined, name: string, fallback?: number): number {
  if (value === undefined && fallback !== undefined) return fallback;
  const result = Number(value);
  if (!Number.isFinite(result)) throw new Error(`${name} must be a finite number`);
  return result;
}

export async function resolvedBoard(boards: Command, target: string) {
  const spaceId = resolveSpace(boards);
  const boardId = await resolveBoardId(spaceId, target);
  return createClient().space(spaceId).board(boardId);
}

export function showUpdated(
  result: { board: { version: number } },
  options: JsonOptions,
) {
  if (jsonRequested(options)) return json(result);
  ok(`Board updated to version ${result.board.version}`);
}
