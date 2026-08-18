import { randomUUID } from "node:crypto";
import {
  boardNodeCreateOperation,
  boardNodeDeleteOperations,
  boardNodePatchOperation,
  createBoardConnection,
  createBoardNode,
  type BoardNodeSpec,
} from "@neta-art/cohub/board";
import type { BoardNodeInput } from "@neta-art/cohub";
import type { Command } from "commander";
import {
  BOARD_DOMAIN_INPUT_MAX_BYTES,
  readBoardJsonObject,
} from "../../board-command-support.js";
import { handleHttp } from "../../output.js";
import {
  type JsonOptions,
  resolvedBoard,
  showUpdated,
  withJson,
} from "./context.js";

export function registerBoardNodeCommands(boards: Command): void {
  const nodes = boards.command("nodes").description("Create and update Board nodes");
  withJson(nodes.command("add <board>")
    .description("Add a node")
    .requiredOption("-i, --input <file>", "BoardNodeSpec JSON; use - for stdin")
    .addHelpText("after", `
Frame x/y/width/height use Board world units. Draw points and arrow endpoints are also world input.
Minimal text node:
  {"id":"title","type":"text","frame":{"x":120,"y":80,"width":320,"height":48},"text":"Launch plan"}`))
    .action(async (target: string, options: JsonOptions & { input: string }) => {
      try {
        const input = await readBoardJsonObject(options.input, BOARD_DOMAIN_INPUT_MAX_BYTES);
        const node = createBoardNode(input as BoardNodeSpec);
        const board = await resolvedBoard(boards, target);
        showUpdated(await board.mutate({ build: () => [boardNodeCreateOperation(node)] }), options);
      } catch (cause) {
        handleHttp(cause);
      }
    });
  withJson(nodes.command("patch <board> <node-id>")
    .description("Patch a node")
    .requiredOption("-i, --input <file>", "BoardNodeInput field patch; use - for stdin")
    .addHelpText("after", `
x/y are absolute Board world coordinates.
Move a node without changing its content:
  {"x":160,"y":120}

Nested view, style, and data fields replace their complete stored object.`))
    .action(async (target: string, nodeId: string, options: JsonOptions & { input: string }) => {
      try {
        const patch = await readBoardJsonObject(options.input, BOARD_DOMAIN_INPUT_MAX_BYTES);
        if ("nodeId" in patch) throw new Error("node patch must not contain nodeId");
        const board = await resolvedBoard(boards, target);
        showUpdated(await board.mutate({
          build: () => [boardNodePatchOperation(nodeId, patch as Partial<Omit<BoardNodeInput, "nodeId">>)],
        }), options);
      } catch (cause) {
        handleHttp(cause);
      }
    });
  withJson(nodes.command("remove <board> <node-id>")
    .alias("rm")
    .description("Remove a node and its connections"))
    .action(async (target: string, nodeId: string, options: JsonOptions) => {
      try {
        const board = await resolvedBoard(boards, target);
        showUpdated(await board.mutate({
          include: ["connections"],
          build: (current) => boardNodeDeleteOperations(nodeId, current.connections),
        }), options);
      } catch (cause) {
        handleHttp(cause);
      }
    });

  withJson(boards.command("connect <board> <source> <target>")
    .description("Connect two Board nodes")
    .option("--id <id>", "Connection id")
    .option("--relation <relation>", "Relation type")
    .option("--direction <direction>", "none, forward, backward, or both", "forward")
    .option("--label <label>", "Connection label")
    .option("--source-port <id>", "Source port id")
    .option("--target-port <id>", "Target port id"))
    .action(async (target: string, source: string, destination: string, options: JsonOptions & {
      id?: string;
      relation?: string;
      direction?: string;
      label?: string;
      sourcePort?: string;
      targetPort?: string;
    }) => {
      try {
        const direction = options.direction ?? "forward";
        if (!["none", "forward", "backward", "both"].includes(direction)) {
          throw new Error("--direction must be none, forward, backward, or both");
        }
        const board = await resolvedBoard(boards, target);
        const connection = createBoardConnection({
          id: options.id ?? randomUUID(),
          sourceNodeId: source,
          targetNodeId: destination,
          relation: options.relation,
          direction: direction as "none" | "forward" | "backward" | "both",
          label: options.label,
          sourcePortId: options.sourcePort,
          targetPortId: options.targetPort,
        });
        showUpdated(await board.mutate({
          build: () => [{ type: "connection.create", payload: { connection } }],
        }), options);
      } catch (cause) {
        handleHttp(cause);
      }
    });
  withJson(boards.command("disconnect <board> <connection-id>")
    .description("Remove a Board connection"))
    .action(async (target: string, connectionId: string, options: JsonOptions) => {
      try {
        const board = await resolvedBoard(boards, target);
        showUpdated(await board.mutate({
          build: () => [{ type: "connection.delete", payload: { connectionId } }],
        }), options);
      } catch (cause) {
        handleHttp(cause);
      }
    });
}
