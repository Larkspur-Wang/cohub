import { randomUUID } from "node:crypto";
import { dispatchRealtimeEvent } from "./channels.js";

export async function dispatchCanvasTransactionApplied(input: {
  spaceId: string;
  documentId: string;
  actorId: string;
  txId: string;
  version: number;
  ops: Array<Record<string, unknown>>;
}) {
  await dispatchRealtimeEvent({
    id: randomUUID(),
    timestamp: Date.now(),
    domain: "space",
    type: "canvas.tx.applied",
    spaceId: input.spaceId,
    sessionId: null,
    payload: {
      documentId: input.documentId,
      actorId: input.actorId,
      txId: input.txId,
      version: input.version,
      ops: input.ops,
    },
  });
}
