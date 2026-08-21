import type { BoardClient, BoardSemanticCommand } from "@neta-art/cohub";
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

/**
 * Send semantic commands with one automatic version-conflict retry: a racing
 * edit between our version read and the submit is transparently rebased (same
 * commands, fresh baseVersion, same id — a retry that lands is idempotent).
 * `options.baseVersion` lets an agent chain mutations without re-reading the
 * board between writes.
 */
export async function mutateSemantic(
  board: BoardClient,
  commands: BoardSemanticCommand[],
  options: { baseVersion?: number; mutationId?: string; dryRun?: boolean } = {},
) {
  const baseVersion = options.baseVersion ?? (await board.summary()).board.version;
  const send = (version: number) =>
    board.mutateSemantic({
      mutationId: options.mutationId,
      baseVersion: version,
      dryRun: options.dryRun ?? false,
      commands,
    });
  try {
    return await send(baseVersion);
  } catch (cause) {
    if (options.dryRun || !isVersionConflict(cause)) throw cause;
    const retry = (await board.summary()).board.version;
    return send(retry);
  }
}

function isVersionConflict(error: unknown): boolean {
  return Boolean(
    error && typeof error === "object" &&
    (error as { code?: unknown }).code === "VERSION_CONFLICT",
  );
}

export function showUpdated(
  result: { board: { version: number }; status?: string; outcome?: string; replayed?: boolean },
  options: JsonOptions,
) {
  if (jsonRequested(options)) return json(result);
  if (result.outcome === "dry-run") {
    ok(`Validated against Board version ${result.board.version}; no changes written`);
    return;
  }
  if (result.outcome === "noop" || result.status === "validated") {
    ok(`Board already matches the requested state at version ${result.board.version}`);
    return;
  }
  ok(`Board updated to version ${result.board.version}${result.replayed ? " (replayed)" : ""}`);
}
