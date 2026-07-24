import type { BoardSemanticOp } from "@neta-art/cohub";
import {
	type BoardPendingTransactionCacheRecord,
	idbDelete,
	idbGetAllByIndex,
	idbPut,
} from "$lib/cache/db";
import { boardPendingTransactionKey, getCacheUserKey } from "$lib/cache/keys";

export type BoardPendingTransaction = {
	spaceId: string;
	documentId: string;
	txId: string;
	baseVersion: number | null;
	ops: BoardSemanticOp[];
};

export async function writeBoardPendingTransaction(
	input: BoardPendingTransaction,
) {
	const userKey = getCacheUserKey();
	const now = Date.now();
	const key = boardPendingTransactionKey(
		userKey,
		input.spaceId,
		input.documentId,
		input.txId,
	);
	const record: BoardPendingTransactionCacheRecord = {
		key,
		userKey,
		spaceId: input.spaceId,
		documentId: input.documentId,
		txId: input.txId,
		baseVersion: input.baseVersion,
		ops: input.ops,
		attemptCount: 0,
		createdAt: now,
		updatedAt: now,
		lastAttemptAt: null,
	};
	await idbPut("board_pending_txs", record);
	return record;
}

export async function deleteBoardPendingTransaction(input: {
	spaceId: string;
	documentId: string;
	txId: string;
}) {
	await idbDelete(
		"board_pending_txs",
		boardPendingTransactionKey(
			getCacheUserKey(),
			input.spaceId,
			input.documentId,
			input.txId,
		),
	);
}

export async function listBoardPendingTransactions(
	spaceId: string,
	documentId: string,
) {
	const rows = await idbGetAllByIndex<BoardPendingTransactionCacheRecord>(
		"board_pending_txs",
		"by_user_space_document",
		IDBKeyRange.only([getCacheUserKey(), spaceId, documentId]),
	);
	return rows.sort((a, b) => a.createdAt - b.createdAt);
}

export async function markBoardPendingTransactionAttempt(
	record: BoardPendingTransactionCacheRecord,
) {
	await idbPut("board_pending_txs", {
		...record,
		attemptCount: record.attemptCount + 1,
		lastAttemptAt: Date.now(),
		updatedAt: Date.now(),
	});
}
