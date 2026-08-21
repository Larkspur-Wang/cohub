import type { BoardMutationReceipt, BoardOperation } from "@cohub/protocol";

/** Derive the semantic resource projection for a persisted wire transaction. */
export function boardMutationChanged(
  operations: readonly BoardOperation[],
): BoardMutationReceipt["changed"] {
  const items = new Set<string>();
  const connections = new Set<string>();
  const effects = new Set<string>();
  const compositions = new Set<string>();
  let board = false;
  let orderChanged = false;
  for (const operation of operations) {
    if (operation.type === "board.patch") board = true;
    else if (operation.type === "node.create") items.add(operation.payload.node.nodeId);
    else if (operation.type === "node.patch" || operation.type === "node.delete") {
      items.add(operation.payload.nodeId);
      if (operation.type === "node.patch" && operation.payload.patch.orderKey !== undefined) orderChanged = true;
    }
    else if (operation.type === "connection.create") connections.add(operation.payload.connection.id);
    else if (operation.type === "connection.patch" || operation.type === "connection.delete") connections.add(operation.payload.connectionId);
    else if (operation.type === "effect.upsert") effects.add(operation.payload.effect.id);
    else if (operation.type === "effect.delete") effects.add(operation.payload.effectId);
    else if (operation.type === "composition.apply") compositions.add(operation.payload.composition.id);
    else if (operation.type === "composition.delete") compositions.add(operation.payload.compositionId);
  }
  return {
    items: [...items],
    connections: [...connections],
    effects: [...effects],
    compositions: [...compositions],
    board,
    orderChanged,
  };
}
