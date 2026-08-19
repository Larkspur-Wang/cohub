import { randomUUID } from "node:crypto";
import { createBoardConnection } from "@neta-art/cohub/board";
import type { Command } from "commander";
import { handleHttp } from "../../output.js";
import {
  type JsonOptions,
  resolvedBoard,
  showUpdated,
  withJson,
} from "./context.js";

/** Connection shortcuts; Item authoring lives in ./items.ts. */
export function registerBoardNodeCommands(boards: Command): void {
  withJson(boards.command("connect <board> <source> <target>")
    .description("Connect two Board items")
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
