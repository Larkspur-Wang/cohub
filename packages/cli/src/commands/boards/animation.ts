import { randomUUID } from "node:crypto";
import {
  BoardCameraFocusParamsSchema,
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
  finite,
  type JsonOptions,
  resolvedBoard,
  showUpdated,
  withJson,
} from "./context.js";

function rect(value: string) {
  const parts = value.split(",").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) {
    throw new Error("--rect must be x,y,width,height");
  }
  const [x, y, width, height] = parts as [number, number, number, number];
  if (width <= 0 || height <= 0) throw new Error("--rect width and height must be positive");
  return { x, y, width, height };
}

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
    .requiredOption("-i, --input <file>", "Board effect JSON; use - for stdin")
    .addHelpText("after", `
Minimal pulse effect:
  {"id":"pulse-title","target":{"type":"node","nodeId":"title"},"kind":"effects.pulse","kindVersion":1,"lifecycle":"when-visible","timeOrigin":"visible","seed":"pulse-title"}

Run boards capabilities <board> to discover supported effect kinds.`))
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
    .requiredOption("-i, --input <file>", "{ sequence, clips } JSON; use - for stdin")
    .addHelpText("after", `
Minimal sequence with one clip:
  {"sequence":{"id":"intro","name":"Intro","duration":1200,"seed":"intro"},"clips":[{"id":"reveal-title","kind":"text.reveal","kindVersion":1,"target":{"type":"node","nodeId":"title"},"start":0,"duration":600,"seed":"reveal-title"}]}

Coordinate rules:
  node motion x/y and path points are Board-world offsets; camera.pan x/y are screen-pixel offsets.

Edit an existing sequence:
  cohub boards sequences get <board> intro --json > intro.json
  cohub boards sequences upsert <board> -i intro.json`))
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
  withJson(sequences.command("camera-focus <board> <sequence-id>")
    .description("Add or replace a semantic camera focus clip")
    .option("--id <id>", "Stable clip id")
    .option("--node <id>", "Focus one node")
    .option("--nodes <ids>", "Focus comma-separated nodes")
    .option("--frame <id>", "Focus a frame")
    .option("--rect <rect>", "Board world rect as x,y,width,height")
    .requiredOption("--at <ms>", "Clip start time")
    .option("--duration <ms>", "Transition duration", "700")
    .option("--padding <px>", "Screen padding in CSS pixels", "32")
    .option("--fit <mode>", "contain or cover", "contain")
    .option("--min-zoom <zoom>", "Minimum zoom multiplier")
    .option("--max-zoom <zoom>", "Maximum zoom multiplier")
    .option("--easing <name>", "Easing", "ease-out-cubic")
    .addHelpText("after", `
Examples:
  cohub boards sequences camera-focus plan.board intro --node hero --at 1200
  cohub boards sequences camera-focus plan.board intro --rect 120,80,640,360 --at 2000 --duration 800`))
    .action(async (target: string, sequenceId: string, options: JsonOptions & {
      id?: string;
      node?: string;
      nodes?: string;
      frame?: string;
      rect?: string;
      at: string;
      duration: string;
      padding: string;
      fit: string;
      minZoom?: string;
      maxZoom?: string;
      easing: string;
    }) => {
      try {
        const selected = [options.node, options.nodes, options.frame, options.rect].filter(Boolean);
        if (selected.length !== 1) throw new Error("Choose one of --node, --nodes, --frame, or --rect");
        const focus = options.node
          ? { type: "node" as const, nodeId: options.node }
          : options.nodes
            ? { type: "nodes" as const, nodeIds: options.nodes.split(",").map((id) => id.trim()).filter(Boolean) }
            : options.frame
              ? { type: "frame" as const, frameId: options.frame }
              : { type: "rect" as const, rect: rect(options.rect as string) };
        const params = BoardCameraFocusParamsSchema.parse({
          focus,
          fit: options.fit,
          padding: finite(options.padding, "padding"),
          ...(options.minZoom === undefined ? {} : { minZoom: finite(options.minZoom, "min zoom") }),
          ...(options.maxZoom === undefined ? {} : { maxZoom: finite(options.maxZoom, "max zoom") }),
        });
        const start = finite(options.at, "start");
        const duration = finite(options.duration, "duration");
        if (start < 0 || duration <= 0) throw new Error("start must be non-negative and duration must be positive");
        const clipId = options.id ?? randomUUID();
        const board = await resolvedBoard(boards, target);
        showUpdated(await board.mutate({
          include: ["sequences", "clips"],
          build(current) {
            const currentSequence = current.sequences.find((sequence) => sequence.id === sequenceId);
            if (!currentSequence) throw new Error(`Sequence not found: ${sequenceId}`);
            const { boardId: _boardId, revision: _revision, ...sequence } = currentSequence;
            const clips = current.clips
              .filter((clip) => clip.sequenceId === sequenceId && clip.id !== clipId)
              .map(({ sequenceId: _sequenceId, ...clip }) => clip);
            clips.push({
              id: clipId,
              kind: "camera.focus",
              kindVersion: 1,
              target: { type: "camera" },
              start,
              duration,
              layer: "screen",
              fill: "forwards",
              easing: options.easing,
              params,
              keyframes: [],
              assetRefs: [],
              seed: clipId,
              metadata: {},
            });
            return [boardSequenceUpsertOperation({
              sequence: { ...sequence, duration: Math.max(sequence.duration, start + duration) },
              clips,
            })];
          },
        }), options);
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
