import { randomUUID } from "node:crypto";
import {
  BoardAuthoringItemSchema,
  BoardItemPatchSchema,
  type BoardSemanticCommand,
} from "@neta-art/cohub";
import type { Command } from "commander";
import {
  BOARD_DOMAIN_INPUT_MAX_BYTES,
  readBoardJsonObject,
} from "../../board-command-support.js";
import { handleHttp, json, jsonRequested, ok, table } from "../../output.js";
import {
  type JsonOptions,
  resolvedBoard,
  withJson,
} from "./context.js";

type MutationOptions = JsonOptions & {
  input?: string;
  baseVersion?: string;
  mutationId?: string;
  cascade?: boolean;
  dryRun?: boolean;
};

const baseVersion = (value: string | undefined, fallback: number) => {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error("base version must be a non-negative integer");
  }
  return parsed;
};

async function execute(
  boards: Command,
  target: string,
  command: BoardSemanticCommand,
  options: MutationOptions,
) {
  const board = await resolvedBoard(boards, target);
  const snapshot = await board.authoring();
  const mutation = {
    mutationId: options.mutationId?.trim() || randomUUID(),
    baseVersion: baseVersion(options.baseVersion, snapshot.board.version),
    commands: [command],
  };
  if (options.dryRun) {
    const result = {
      mutationId: mutation.mutationId,
      status: "prepared",
      board: { id: snapshot.board.id, version: snapshot.board.version },
      commands: mutation.commands,
    };
    if (jsonRequested(options)) return json(result);
    ok(`Prepared against Board version ${snapshot.board.version}; no server validation or write performed`);
    return;
  }
  const receipt = await board.mutateSemantic(mutation);
  if (jsonRequested(options)) return json(receipt);
  ok(`${receipt.replayed ? "Replayed" : "Applied"} mutation at Board version ${receipt.board.version}`);
}

function mutationOptions(command: Command) {
  return withJson(command)
    .option("--base-version <version>", "Expected Board version; defaults to latest")
    .option("--mutation-id <id>", "Stable id for safe retries")
    .option("--dry-run", "Prepare locally without server validation or writing");
}

export function registerBoardItemCommands(boards: Command): void {
  const items = boards.command("items").description("Author Board items with semantic JSON");

  withJson(items.command("list <board>").alias("ls").description("List semantic Board items"))
    .action(async (target: string, options: JsonOptions) => {
      try {
        const board = await resolvedBoard(boards, target);
        const snapshot = await board.authoring();
        if (jsonRequested(options)) return json(snapshot.items);
        table(snapshot.items.map((item) => ({
          id: item.id,
          type: item.type,
          x: item.frame.x,
          y: item.frame.y,
          width: item.frame.width,
          height: item.frame.height,
        })), [
          { key: "id", label: "ID" },
          { key: "type", label: "TYPE" },
          { key: "x", label: "X" },
          { key: "y", label: "Y" },
          { key: "width", label: "WIDTH" },
          { key: "height", label: "HEIGHT" },
        ]);
      } catch (cause) {
        handleHttp(cause);
      }
    });

  mutationOptions(items.command("create <board>")
    .description("Create one item")
    .requiredOption("-i, --input <file>", "Board Item JSON; use - for stdin")
    .addHelpText("after", `
Minimal text item:
  {"id":"title","type":"text","frame":{"x":120,"y":80,"width":320,"height":48,"rotation":0},"props":{"text":"Launch plan","fontSize":32},"style":{"color":"brand"}}`))
    .action(async (target: string, options: MutationOptions & { input: string }) => {
      try {
        const value = await readBoardJsonObject(options.input, BOARD_DOMAIN_INPUT_MAX_BYTES);
        await execute(boards, target, {
          type: "item.create",
          item: BoardAuthoringItemSchema.parse(value),
        }, options);
      } catch (cause) {
        handleHttp(cause);
      }
    });

  mutationOptions(items.command("patch <board> <item-id>")
    .description("Recursively merge item fields")
    .requiredOption("-i, --input <file>", "Board Item patch JSON; use - for stdin")
    .addHelpText("after", `
Objects merge recursively, arrays replace, and null clears optional fields.
Move and rename a text item without replacing its size or font:
  {"frame":{"x":160,"y":120},"props":{"text":"Updated"}}`))
    .action(async (target: string, itemId: string, options: MutationOptions & { input: string }) => {
      try {
        const value = await readBoardJsonObject(options.input, BOARD_DOMAIN_INPUT_MAX_BYTES);
        await execute(boards, target, {
          type: "item.patch",
          itemId,
          patch: BoardItemPatchSchema.parse(value),
        }, options);
      } catch (cause) {
        handleHttp(cause);
      }
    });

  mutationOptions(items.command("replace <board> <item-id>")
    .description("Replace one complete item")
    .requiredOption("-i, --input <file>", "Complete Board Item JSON; use - for stdin"))
    .action(async (target: string, itemId: string, options: MutationOptions & { input: string }) => {
      try {
        const value = await readBoardJsonObject(options.input, BOARD_DOMAIN_INPUT_MAX_BYTES);
        await execute(boards, target, {
          type: "item.replace",
          itemId,
          item: BoardAuthoringItemSchema.parse(value),
        }, options);
      } catch (cause) {
        handleHttp(cause);
      }
    });

  mutationOptions(items.command("delete <board> <item-id>").alias("rm")
    .description("Delete one item")
    .option("--cascade", "Atomically remove relations, effects, and animation references"))
    .action(async (target: string, itemId: string, options: MutationOptions) => {
      try {
        await execute(boards, target, {
          type: "item.delete",
          itemId,
          cascade: Boolean(options.cascade),
        }, options);
      } catch (cause) {
        handleHttp(cause);
      }
    });
}
