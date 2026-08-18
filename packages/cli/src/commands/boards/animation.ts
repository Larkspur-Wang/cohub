import {
  boardEffectDeleteOperation,
  boardEffectUpsertOperation,
  boardSequenceDeleteOperation,
  boardSequenceUpsertOperation,
} from "@neta-art/cohub/board";
import type {
  BoardClip,
  BoardEffect,
  BoardSequence,
} from "@neta-art/cohub";
import type { Command } from "commander";
import {
  BOARD_DOMAIN_INPUT_MAX_BYTES,
  readBoardJsonObject,
} from "../../board-command-support.js";
import { handleHttp, json, jsonRequested, table } from "../../output.js";
import {
  type JsonOptions,
  resolvedBoard,
  showUpdated,
  withJson,
} from "./context.js";

export function registerBoardAnimationCommands(boards: Command): void {
  const effects = boards.command("effects").description("Manage Board effects");
  withJson(effects.command("list <board>").alias("ls").description("List effects"))
    .action(async (target: string, options: JsonOptions) => {
      try {
        const board = await resolvedBoard(boards, target);
        const result = await board.inspect({ include: ["effects"] });
        if (jsonRequested(options)) return json(result.effects);
        table(result.effects, [
          { key: "id", label: "ID" },
          { key: "kind", label: "KIND" },
          { key: "enabled", label: "ENABLED" },
          { key: "layer", label: "LAYER" },
        ]);
      } catch (cause) {
        handleHttp(cause);
      }
    });
  withJson(effects.command("upsert <board>")
    .description("Create or replace an effect")
    .requiredOption("-i, --input <file>", "Effect JSON; use - for stdin"))
    .action(async (target: string, options: JsonOptions & { input: string }) => {
      try {
        const effect = await readBoardJsonObject(options.input, BOARD_DOMAIN_INPUT_MAX_BYTES) as Omit<BoardEffect, "boardId" | "revision">;
        const board = await resolvedBoard(boards, target);
        showUpdated(await board.mutate({ build: () => [boardEffectUpsertOperation(effect)] }), options);
      } catch (cause) {
        handleHttp(cause);
      }
    });
  withJson(effects.command("delete <board> <effect-id>").alias("rm").description("Delete an effect"))
    .action(async (target: string, effectId: string, options: JsonOptions) => {
      try {
        const board = await resolvedBoard(boards, target);
        showUpdated(await board.mutate({ build: () => [boardEffectDeleteOperation(effectId)] }), options);
      } catch (cause) {
        handleHttp(cause);
      }
    });

  const sequences = boards.command("sequences").description("Manage Board sequences");
  withJson(sequences.command("list <board>").alias("ls").description("List sequences"))
    .action(async (target: string, options: JsonOptions) => {
      try {
        const board = await resolvedBoard(boards, target);
        const result = await board.inspect({ include: ["sequences"] });
        if (jsonRequested(options)) return json(result.sequences);
        table(result.sequences, [
          { key: "id", label: "ID" },
          { key: "name", label: "NAME" },
          { key: "duration", label: "DURATION" },
          { key: "revision", label: "REVISION" },
        ]);
      } catch (cause) {
        handleHttp(cause);
      }
    });
  withJson(sequences.command("get <board> <sequence-id>").description("Get a sequence and its clips"))
    .action(async (target: string, sequenceId: string, options: JsonOptions) => {
      try {
        const board = await resolvedBoard(boards, target);
        const result = await board.inspect({ include: ["sequences", "clips"] });
        const sequence = result.sequences.find((item) => item.id === sequenceId);
        if (!sequence) throw new Error(`Sequence not found: ${sequenceId}`);
        const output = {
          sequence,
          clips: result.clips.filter((clip) => clip.sequenceId === sequenceId),
        };
        if (jsonRequested(options)) return json(output);
        table([sequence], [
          { key: "id", label: "ID" },
          { key: "name", label: "NAME" },
          { key: "duration", label: "DURATION" },
          { key: "revision", label: "REVISION" },
        ]);
        table(output.clips, [
          { key: "id", label: "CLIP" },
          { key: "kind", label: "KIND" },
          { key: "start", label: "START" },
          { key: "duration", label: "DURATION" },
        ]);
      } catch (cause) {
        handleHttp(cause);
      }
    });
  withJson(sequences.command("upsert <board>")
    .description("Create or replace a sequence and clips")
    .requiredOption("-i, --input <file>", "{ sequence, clips } JSON; use - for stdin"))
    .action(async (target: string, options: JsonOptions & { input: string }) => {
      try {
        const input = await readBoardJsonObject(options.input, BOARD_DOMAIN_INPUT_MAX_BYTES) as {
          sequence: Omit<BoardSequence, "boardId" | "revision">;
          clips: Array<Omit<BoardClip, "sequenceId">>;
        };
        const board = await resolvedBoard(boards, target);
        showUpdated(await board.mutate({ build: () => [boardSequenceUpsertOperation(input)] }), options);
      } catch (cause) {
        handleHttp(cause);
      }
    });
  withJson(sequences.command("delete <board> <sequence-id>").alias("rm").description("Delete a sequence and its clips"))
    .action(async (target: string, sequenceId: string, options: JsonOptions) => {
      try {
        const board = await resolvedBoard(boards, target);
        showUpdated(await board.mutate({ build: () => [boardSequenceDeleteOperation(sequenceId)] }), options);
      } catch (cause) {
        handleHttp(cause);
      }
    });
}
