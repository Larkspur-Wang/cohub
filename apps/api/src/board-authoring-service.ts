import {
	applyBoardItemPatch,
	boardAuthoringItemToNode,
	boardNodePatch,
	boardNodeToAuthoringItem,
	preserveOpaqueNodeFields,
} from "@cohub/core/board";
import {
	BoardSemanticMutationSchema,
	type BoardAuthoringSnapshot,
	type BoardComposition,
	type BoardMutationReceipt,
	type BoardNodeInput,
	type BoardOperation,
	type BoardSemanticMutation,
	type RequestSource,
} from "@cohub/protocol";
import { and, eq } from "drizzle-orm";
import { boardTransactions, boards } from "@cohub/db";
import {
	applyBoardTransaction,
	inspectBoard,
	receiptFromStoredTransaction,
} from "./board-service.js";
import { db } from "./db/index.js";
import { BoardServiceError } from "./board-ops.js";

const inputFromRecord = (node: Awaited<ReturnType<typeof inspectBoard>>["nodes"][number]): BoardNodeInput => ({
	nodeId: node.nodeId,
	type: node.type,
	parentId: node.parentId,
	orderKey: node.orderKey,
	x: node.x,
	y: node.y,
	width: node.width,
	height: node.height,
	rotation: node.rotation,
	refKind: node.refKind,
	refPath: node.refPath,
	refUrl: node.refUrl,
	view: node.view,
	style: node.style,
	data: node.data,
});

export async function inspectBoardAuthoring(
	spaceId: string,
	boardId: string,
): Promise<BoardAuthoringSnapshot> {
	const snapshot = await inspectBoard(spaceId, boardId, { include: ["nodes"] });
	return {
		board: {
			id: snapshot.board.id,
			title: snapshot.board.title,
			version: snapshot.board.version,
			metadata: snapshot.board.metadata,
			updatedAt: snapshot.board.updatedAt,
		},
		items: snapshot.nodes.map(boardNodeToAuthoringItem),
	};
}

function nextOrderKey(nodes: Iterable<BoardNodeInput>): () => string {
	let last: string | null = null;
	for (const node of nodes) {
		if (node.orderKey && (last === null || node.orderKey > last)) last = node.orderKey;
	}
	return () => {
		if (last === null) {
			last = "00004096";
			return last;
		}
		if (/^\d+$/.test(last)) {
			const value = Number(last);
			if (Number.isSafeInteger(value)) {
				const next = String(value + 4096).padStart(last.length, "0");
				if (next.length === last.length && next > last) {
					last = next;
					return last;
				}
			}
		}
		last = `${last}5`;
		return last;
	};
}

function compositionReferencesItem(composition: BoardComposition, itemId: string): boolean {
	return (
		composition.timeline.tracks.some(
			(track) => track.target.type === "item" && track.target.itemId === itemId,
		) ||
		composition.timeline.clips.some((clip) => {
			if (clip.target.type === "item" && clip.target.itemId === itemId) return true;
			if (clip.kind !== "camera.focus") return false;
			const focus = clip.params.focus;
			if (!focus || typeof focus !== "object" || Array.isArray(focus)) return false;
			const value = focus as Record<string, unknown>;
			return value.itemId === itemId ||
				(Array.isArray(value.itemIds) && value.itemIds.includes(itemId)) ||
				value.frameId === itemId;
		})
	);
}

function withoutCascadeReferences(
	composition: BoardComposition,
	itemId: string,
	effectIds: ReadonlySet<string>,
): Omit<BoardComposition, "revision"> {
	return {
		id: composition.id,
		name: composition.name,
		timeline: {
			...composition.timeline,
			tracks: composition.timeline.tracks.filter((track) =>
				!(track.target.type === "item" && track.target.itemId === itemId) &&
				!(track.target.type === "effect" && effectIds.has(track.target.effectId)),
			),
			clips: composition.timeline.clips.filter((clip) => {
				if (clip.target.type === "item" && clip.target.itemId === itemId) return false;
				if (clip.target.type === "effect" && effectIds.has(clip.target.effectId)) return false;
				if (clip.kind !== "camera.focus") return true;
				const focus = clip.params.focus;
				if (!focus || typeof focus !== "object" || Array.isArray(focus)) return true;
				const value = focus as Record<string, unknown>;
				return value.itemId !== itemId &&
					!(Array.isArray(value.itemIds) && value.itemIds.includes(itemId)) &&
					value.frameId !== itemId;
			}),
		},
		playback: composition.playback,
		metadata: composition.metadata,
	};
}

/** Compile semantic authoring commands into one authoritative Board transaction. */
export async function applySemanticBoardMutation(input: {
	spaceId: string;
	boardId: string;
	actorId: string;
	mutation: unknown;
	requestSource?: RequestSource | null;
}): Promise<BoardMutationReceipt> {
	const parsed = BoardSemanticMutationSchema.safeParse(input.mutation);
	if (!parsed.success) {
		throw new BoardServiceError(
			400,
			parsed.error.issues[0]?.message ?? "invalid Board mutation",
			"INVALID_BOARD_MUTATION",
		);
	}
	const mutation = parsed.data as BoardSemanticMutation;
	const [ownedBoard] = await db.select({ id: boards.id })
		.from(boards)
		.where(and(eq(boards.id, input.boardId), eq(boards.spaceId, input.spaceId)))
		.limit(1);
	if (!ownedBoard) throw new BoardServiceError(404, "board not found", "BOARD_NOT_FOUND");
	const [storedTransaction] = await db.select({
		receipt: boardTransactions.receipt,
		resultVersion: boardTransactions.resultVersion,
		operations: boardTransactions.operations,
	})
		.from(boardTransactions)
		.where(
			and(
				eq(boardTransactions.boardId, input.boardId),
				eq(boardTransactions.txId, mutation.mutationId),
			),
		)
		.limit(1);
	if (storedTransaction) {
		return receiptFromStoredTransaction({
			boardId: input.boardId,
			txId: mutation.mutationId,
			resultVersion: storedTransaction.resultVersion,
			operations: storedTransaction.operations,
			receipt: storedTransaction.receipt,
		});
	}
	const current = await inspectBoard(input.spaceId, input.boardId, {
		include: ["nodes", "connections", "effects", "compositions"],
	});
	if (mutation.baseVersion !== current.board.version) {
		throw new BoardServiceError(
			409,
			`expected Board version ${current.board.version}, received ${mutation.baseVersion}`,
			"VERSION_CONFLICT",
		);
	}

	const nodes = new Map(current.nodes.map((node) => [node.nodeId, inputFromRecord(node)]));
	const connections = new Map(current.connections.map((connection) => [connection.id, connection]));
	const effects = new Map(current.effects.map((effect) => [effect.id, effect]));
	const compositions = new Map(current.compositions.map((composition) => [composition.id, composition]));
	const allocateOrderKey = nextOrderKey(nodes.values());
	const operations: BoardOperation[] = [];

	for (const command of mutation.commands) {
		if (command.type === "item.create") {
			if (nodes.has(command.item.id)) {
				throw new BoardServiceError(409, `item already exists: ${command.item.id}`, "ITEM_EXISTS");
			}
			const node = boardAuthoringItemToNode(command.item, { orderKey: allocateOrderKey() });
			nodes.set(node.nodeId, node);
			operations.push({ type: "node.create", payload: { node } });
			continue;
		}
		const existing = nodes.get(command.itemId);
		if (!existing) {
			throw new BoardServiceError(404, `item does not exist: ${command.itemId}`, "ITEM_NOT_FOUND");
		}
		if (command.type === "item.patch") {
			const item = applyBoardItemPatch(boardNodeToAuthoringItem(existing), command.patch);
			const next = preserveOpaqueNodeFields(
				existing,
				boardAuthoringItemToNode(item, { orderKey: existing.orderKey }),
			);
			const patch = boardNodePatch(existing, next);
			if (Object.keys(patch).length > 0) {
				operations.push({ type: "node.patch", payload: { nodeId: command.itemId, patch } });
				nodes.set(command.itemId, next);
			}
			continue;
		}
		if (command.type === "item.replace") {
			if (command.item.id !== command.itemId) {
				throw new BoardServiceError(400, "replacement item id must match itemId", "INVALID_BOARD_ITEM");
			}
			const next = boardAuthoringItemToNode(command.item, { orderKey: existing.orderKey });
			const patch = boardNodePatch(existing, next);
			if (Object.keys(patch).length > 0) {
				operations.push({ type: "node.patch", payload: { nodeId: command.itemId, patch } });
				nodes.set(command.itemId, next);
			}
			continue;
		}

		if (command.cascade) {
			const effectIds = new Set(
				[...effects.values()]
					.filter((effect) => effect.target.type === "item" && effect.target.itemId === command.itemId)
					.map((effect) => effect.id),
			);
			for (const connection of connections.values()) {
				if (connection.source.nodeId === command.itemId || connection.target.nodeId === command.itemId) {
					operations.push({
						type: "connection.delete",
						payload: { connectionId: connection.id, reason: "node-cascade" },
					});
					connections.delete(connection.id);
				}
			}
			for (const composition of compositions.values()) {
				const touchesEffect = composition.timeline.tracks.some(
					(track) => track.target.type === "effect" && effectIds.has(track.target.effectId),
				) || composition.timeline.clips.some(
					(clip) => clip.target.type === "effect" && effectIds.has(clip.target.effectId),
				);
				if (compositionReferencesItem(composition, command.itemId) || touchesEffect) {
					const nextComposition = withoutCascadeReferences(composition, command.itemId, effectIds);
					operations.push({
						type: "composition.apply",
						payload: { composition: nextComposition },
					});
					compositions.set(composition.id, { ...nextComposition, revision: composition.revision });
				}
			}
			for (const effectId of effectIds) {
				operations.push({ type: "effect.delete", payload: { effectId } });
				effects.delete(effectId);
			}
		}
		operations.push({ type: "node.delete", payload: { nodeId: command.itemId } });
		nodes.delete(command.itemId);
	}

	const receipt = await applyBoardTransaction({
		spaceId: input.spaceId,
		actorId: input.actorId,
		requestSource: input.requestSource,
		allowNoop: true,
		transaction: {
			txId: mutation.mutationId,
			boardId: input.boardId,
			baseVersion: mutation.baseVersion,
			...(mutation.clientId ? { clientId: mutation.clientId } : {}),
			...(mutation.undoGroupId ? { undoGroupId: mutation.undoGroupId } : {}),
			operations,
		},
	});
	return receipt;
}
