import type {
	BoardBootstrap,
	BoardOperation,
	BoardPlaybackSnapshot,
	SpaceFsFileResponse,
	SpaceFsPreparingFile,
} from "@neta-art/cohub";
import { BoardTransactionError, HttpError } from "@neta-art/cohub";
import type { BoardDocument } from "@neta-art/cohub-board";
import {
	applyBoardOps,
	boardBootstrapToDocument,
	parseBoardManifest,
	toWireOperations,
} from "$lib/board/board-document";
import { resolveBoardManifestText } from "$lib/board/board-manifest-text";
import {
	type BoardRuntimeData,
	operationsRequireBoardRuntimeRefresh,
} from "$lib/board/runtime/board-runtime";
import {
	deleteBoardPendingTransaction,
	listBoardPendingTransactions,
	markBoardPendingTransactionAttempt,
	writeBoardPendingTransaction,
} from "$lib/cache/repositories/board-pending-tx-repo";
import { sdk } from "$lib/sdk";
import { tryResolveTextFileResponse } from "$lib/space-file-text";

type BoardFileResponse = SpaceFsFileResponse | SpaceFsPreparingFile;

/** Cap on automatic conflict-rebase retries before surfacing an error. */
const MAX_CONFLICT_RECOVERY = 5;

export type InlineBoardPanelState = {
	path: string;
	boardId: string | null;
	document: BoardDocument | null;
	runtime: BoardRuntimeData | null;
	loading: boolean;
	saving: boolean;
	error: string | null;
	saveError: string | null;
};

type BoardPreviewControllerOptions = {
	getSpaceId: () => string;
	getSourceKey: () => string;
	getReadonly?: () => boolean;
	readFile: (path: string) => Promise<BoardFileResponse>;
	onOpenPanel?: () => void;
	onClosePanel?: () => void;
	onBeforeOpenBoard?: () => void;
	onMarkSavePending?: (path: string) => void;
	onClearSavePendingSoon?: (path: string) => void;
};

export function createBoardPreviewController(
	options: BoardPreviewControllerOptions,
) {
	let boards = $state<InlineBoardPanelState[]>([]);
	let activeBoardPath = $state<string | null>(null);
	let requestTokenByPath = $state<Record<string, number>>({});
	let syncVersionByBoardId = $state<Record<string, number | null>>({});
	const pendingFlushByBoardId = new Map<string, Promise<void>>();
	const pendingFlushRequested = new Set<string>();
	/** Conflict-recovery attempts per document, to bound rebase retries. */
	let conflictAttemptsByBoardId: Record<string, number> = {};
	/**
	 * Remote events deferred while a save is in flight. Never dropped: drained in
	 * version order after the commit settles. When the queued sequence is
	 * contiguous with the local baseline we apply ops incrementally; any gap
	 * falls back to a full bootstrap.
	 */
	type PendingRemoteEvent = {
		boardId: string;
		version: number;
		txId: string;
		ops: BoardOperation[];
	};
	let pendingRemoteEvents: PendingRemoteEvent[] = [];
	/** Documents that need a full bootstrap (version gap / missing ops). */
	let pendingRemoteBootstrap = new Set<string>();
	/** Documents currently inside drainRemoteRefresh — serialise per document. */
	const drainingDocuments = new Set<string>();
	/**
	 * txIds this client has successfully committed. Used to recognise our own
	 * transactions echoed back over realtime (which the editor already reflects),
	 * so they are skipped — while the *same user's other tabs/devices* (which send
	 * different txIds) are still reconciled. Keying on txId, not actorId, is what
	 * makes multi-tab editing work.
	 */
	const ownTxIds = new Set<string>();
	/**
	 * Documents with a conflict recovery in flight. While set, stale pending txs
	 * are NOT deleted up front — they are removed only once the editor's rebase
	 * re-commit durably writes a fresh transaction (see commitBoard). This closes
	 * the loss window where a crash or board-close between "delete stale" and
	 * "re-commit" would otherwise discard uncommitted local changes.
	 */
	const pendingRecoveryCleanup = new Set<string>();

	/** A transaction was rejected as a version conflict (409) and can be rebased. */
	function isVersionConflict(error: unknown): boolean {
		if (error instanceof BoardTransactionError) return error.isVersionConflict;
		if (error instanceof HttpError) return error.code === "VERSION_CONFLICT";
		return false;
	}

	function isCurrent(token: number, path: string, sourceKey: string) {
		const board = boards.find((item) => item.path === path);
		return (
			token === requestTokenByPath[path] &&
			Boolean(board) &&
			sourceKey === options.getSourceKey()
		);
	}

	async function openBoard(path: string) {
		const sourceKey = options.getSourceKey();
		options.onOpenPanel?.();
		options.onBeforeOpenBoard?.();
		const token = (requestTokenByPath[path] ?? 0) + 1;
		requestTokenByPath = { ...requestTokenByPath, [path]: token };
		activeBoardPath = path;
		const loadingBoard: InlineBoardPanelState = {
			path,
			boardId: null,
			document: null,
			runtime: null,
			loading: true,
			saving: false,
			error: null,
			saveError: null,
		};
		boards = boards.some((item) => item.path === path)
			? boards.map((item) => (item.path === path ? loadingBoard : item))
			: [...boards, loadingBoard];
		try {
			const rawFile = await options.readFile(path);
			if (!isCurrent(token, path, sourceKey)) return;
			if (!rawFile || typeof rawFile !== "object" || !("content" in rawFile)) {
				throw new Error("Board manifest is being prepared. Retry in a moment.");
			}
			const { file, error: hydrateError } =
				await tryResolveTextFileResponse(rawFile);
			if (!isCurrent(token, path, sourceKey)) return;
			if (hydrateError) throw new Error(hydrateError);
			// .board is JSON text; tolerate misclassified binary responses
			// (e.g. unknown MIME before the extension was registered).
			const content = resolveBoardManifestText(file);
			if (content == null) {
				throw new Error("Board manifest must be a text file.");
			}
			const manifest = parseBoardManifest(content);
			if (!manifest) throw new Error("Board manifest is invalid.");
			const bootstrap = await sdk
				.space(options.getSpaceId())
				.boards.inspect(manifest.boardId);
			if (!isCurrent(token, path, sourceKey)) return;
			syncVersionByBoardId = {
				...syncVersionByBoardId,
				[bootstrap.board.id]: bootstrap.board.version,
			};
			boards = boards.map((item) =>
				item.path === path
					? {
							path,
							boardId: bootstrap.board.id,
							document: boardBootstrapToDocument(bootstrap),
							runtime: {
								effects: bootstrap.effects,
								sequences: bootstrap.sequences,
								clips: bootstrap.clips,
								playback: bootstrap.playback,
							},
							loading: false,
							saving: false,
							error: null,
							saveError: null,
						}
					: item,
			);
			if (!options.getReadonly?.()) {
				void flushPendingTransactions(bootstrap.board.id).catch((error) => {
					setBoardError(
						bootstrap.board.id,
						error instanceof Error
							? error.message
							: "Board changes are saved locally and will retry.",
					);
				});
			}
		} catch (error) {
			if (!isCurrent(token, path, sourceKey)) return;
			boards = boards.map((item) =>
				item.path === path
					? {
							path,
							boardId: null,
							document: null,
							runtime: null,
							loading: false,
							saving: false,
							error:
								error instanceof Error ? error.message : "Failed to open board",
							saveError: null,
						}
					: item,
			);
		}
	}

	function closeBoard(path = activeBoardPath) {
		if (!path) return;
		requestTokenByPath = {
			...requestTokenByPath,
			[path]: (requestTokenByPath[path] ?? 0) + 1,
		};
		const index = boards.findIndex((item) => item.path === path);
		const nextBoards = boards.filter((item) => item.path !== path);
		boards = nextBoards;
		if (activeBoardPath === path)
			activeBoardPath =
				nextBoards[Math.max(0, index - 1)]?.path ?? nextBoards[0]?.path ?? null;
		if (nextBoards.length === 0) options.onClosePanel?.();
	}

	function activateBoard(path: string) {
		if (!boards.some((item) => item.path === path)) return;
		activeBoardPath = path;
		options.onOpenPanel?.();
	}

	function flushPendingTransactions(boardId: string): Promise<void> {
		const activeFlush = pendingFlushByBoardId.get(boardId);
		if (activeFlush) {
			pendingFlushRequested.add(boardId);
			return activeFlush;
		}
		const flush = (async () => {
			try {
				do {
					pendingFlushRequested.delete(boardId);
					while (true) {
						const pending = await listBoardPendingTransactions(
							options.getSpaceId(),
							boardId,
						);
						if (pending.length === 0) break;
						const tx = pending[0];
						if (!tx) break;
						await markBoardPendingTransactionAttempt(tx);
						try {
							const result = await sdk
								.space(options.getSpaceId())
								.boards.apply({
									txId: tx.txId,
									boardId,
									baseVersion: tx.baseVersion,
									operations: toWireOperations(tx.ops),
								});
							syncVersionByBoardId = {
								...syncVersionByBoardId,
								[boardId]: result.board.version,
							};
							// A successful commit resets the conflict-recovery budget.
							delete conflictAttemptsByBoardId[boardId];
							// ownTxIds is registered when the pending tx is written; keep
							// the id here too for txs recovered from durable storage.
							ownTxIds.add(tx.txId);
							if (ownTxIds.size > 256) {
								const oldest = ownTxIds.values().next().value;
								if (oldest) ownTxIds.delete(oldest);
							}
							await deleteBoardPendingTransaction({
								spaceId: options.getSpaceId(),
								boardId,
								txId: tx.txId,
							});
						} catch (error) {
							const attempts = conflictAttemptsByBoardId[boardId] ?? 0;
							if (
								isVersionConflict(error) &&
								attempts < MAX_CONFLICT_RECOVERY
							) {
								// A recovery is already in flight: this stale tx will be superseded
								// by the rebase re-commit, so stop rather than re-recovering.
								if (pendingRecoveryCleanup.has(boardId)) break;
								conflictAttemptsByBoardId[boardId] = attempts + 1;
								// Rebase onto the server truth and restart the loop; the editor
								// re-commits a fresh transaction with the correct base version.
								await recoverFromConflict(boardId);
								break;
							}
							throw error;
						}
					}
				} while (pendingFlushRequested.delete(boardId));
			} finally {
				pendingFlushByBoardId.delete(boardId);
			}
		})();
		pendingFlushByBoardId.set(boardId, flush);
		return flush;
	}

	/**
	 * Recover from a version conflict: fetch the server truth and hand it to the
	 * editor, which rebases its optimistic local changes onto it (reconcileExternal)
	 * and re-commits a single correct transaction. The now-stale pending txs are
	 * NOT deleted here — they are removed in commitBoard only after the fresh
	 * rebase transaction is durably written, so local changes survive a crash or
	 * board-close mid-recovery (the stale txs simply replay and re-recover).
	 */
	async function recoverFromConflict(boardId: string) {
		const bootstrap = await sdk
			.space(options.getSpaceId())
			.boards.inspect(boardId);
		syncVersionByBoardId = {
			...syncVersionByBoardId,
			[boardId]: bootstrap.board.version,
		};
		// Mark recovery in flight; commitBoard performs the stale-tx cleanup once
		// the fresh rebase transaction is persisted.
		pendingRecoveryCleanup.add(boardId);
		// Push the remote document to the editor (clearing `saving` so it is
		// accepted); the rebase + re-commit happens inside the editor.
		boards = boards.map((item) =>
			item.boardId === boardId
				? {
						...item,
						document: boardBootstrapToDocument(bootstrap),
						runtime: {
							effects: bootstrap.effects,
							sequences: bootstrap.sequences,
							clips: bootstrap.clips,
							playback: bootstrap.playback,
						},
						saving: false,
						saveError: null,
					}
				: item,
		);
	}

	/**
	 * Remove every pending transaction for a document except `keepTxId` (the fresh
	 * rebase transaction just persisted). Called once a recovery's re-commit is
	 * durable, so the stale pre-conflict txs are dropped only after their changes
	 * are safely re-recorded — never before.
	 */
	async function cleanupStaleTransactions(boardId: string, keepTxId: string) {
		pendingRecoveryCleanup.delete(boardId);
		const remaining = await listBoardPendingTransactions(
			options.getSpaceId(),
			boardId,
		);
		for (const other of remaining) {
			if (other.txId === keepTxId) continue;
			await deleteBoardPendingTransaction({
				spaceId: options.getSpaceId(),
				boardId,
				txId: other.txId,
			});
		}
	}

	async function commitBoard(document: BoardDocument, ops: BoardOperation[]) {
		const board = boards.find((item) => item.path === activeBoardPath);
		if (options.getReadonly?.() || !board?.boardId) return;
		const boardId = board.boardId;
		const savingPath = board.path;
		const txId = crypto.randomUUID();
		// A recovery re-commit with no resulting ops still must clear the stale
		// pending txs (their changes are already reflected server-side).
		if (ops.length === 0) {
			if (pendingRecoveryCleanup.has(boardId))
				await cleanupStaleTransactions(boardId, txId);
			return;
		}
		options.onMarkSavePending?.(savingPath);
		boards = boards.map((item) =>
			item.path === savingPath
				? { ...item, saving: true, saveError: null }
				: item,
		);
		try {
			const baseVersion = syncVersionByBoardId[boardId];
			if (baseVersion == null) throw new Error("Board version is unavailable");
			await writeBoardPendingTransaction({
				spaceId: options.getSpaceId(),
				boardId,
				txId,
				baseVersion,
				ops,
			});
			// Register before apply/realtime can race back, so our own echo is
			// skipped and does not wipe editor undo history via a remote load.
			ownTxIds.add(txId);
			if (ownTxIds.size > 256) {
				const oldest = ownTxIds.values().next().value;
				if (oldest) ownTxIds.delete(oldest);
			}
		} catch (error) {
			boards = boards.map((item) =>
				item.path === savingPath
					? {
							...item,
							saving: false,
							saveError: error instanceof Error ? error.message : "Sync failed",
						}
					: item,
			);
			options.onClearSavePendingSoon?.(savingPath);
			void drainRemoteRefresh(boardId);
			throw error;
		}
		// The fresh (rebase) transaction is now durable; it supersedes any stale
		// pending txs from an in-flight recovery, so they can be safely removed.
		if (pendingRecoveryCleanup.has(boardId))
			await cleanupStaleTransactions(boardId, txId);
		boards = boards.map((item) =>
			item.path === savingPath ? { ...item, document } : item,
		);
		try {
			await flushPendingTransactions(boardId);
			boards = boards.map((item) =>
				item.path === savingPath
					? { ...item, saving: false, saveError: null }
					: item,
			);
		} catch (error) {
			boards = boards.map((item) =>
				item.path === savingPath
					? {
							...item,
							saving: false,
							saveError:
								error instanceof Error
									? error.message
									: "Board changes are saved locally and will retry.",
						}
					: item,
			);
		} finally {
			options.onClearSavePendingSoon?.(savingPath);
			// Apply any remote refresh that arrived while this save was in flight.
			void drainRemoteRefresh(boardId);
		}
	}

	/** True if this txId was committed by this client (an echo to skip). */
	function isOwnTransaction(txId: unknown): boolean {
		return typeof txId === "string" && ownTxIds.has(txId);
	}

	function isBusy(boardId: string): boolean {
		const board = boards.find((item) => item.boardId === boardId);
		return Boolean(board?.saving || pendingFlushByBoardId.has(boardId));
	}

	/**
	 * Full-document remote refresh (bootstrap). Used as a fallback when ops are
	 * missing or the version sequence has a gap.
	 */
	function requestRemoteRefresh(boardId: string) {
		pendingRemoteBootstrap.add(boardId);
		if (isBusy(boardId)) return;
		void drainRemoteRefresh(boardId);
	}

	/**
	 * Prefer incremental ops application. Falls back to bootstrap on gaps.
	 */
	function requestRemoteOps(
		boardId: string,
		event: { version: number; txId: string; ops: BoardOperation[] },
	) {
		pendingRemoteEvents.push({
			boardId,
			version: event.version,
			txId: event.txId,
			ops: event.ops,
		});
		if (isBusy(boardId)) return;
		void drainRemoteRefresh(boardId);
	}

	function applyRemoteOpsLocally(
		boardId: string,
		version: number,
		ops: BoardOperation[],
	): boolean {
		const board = boards.find((item) => item.boardId === boardId);
		if (!board || board.saving || !board.document) return false;
		const localVersion = syncVersionByBoardId[boardId] ?? null;
		if (localVersion == null) return false;
		if (version <= localVersion) return true; // already applied / stale
		if (version !== localVersion + 1) return false; // gap → bootstrap
		// Runtime revisions are assigned by the server and are not represented in
		// the document codec. Refresh the full bootstrap rather than advancing the
		// version while silently retaining stale effects or sequences.
		if (operationsRequireBoardRuntimeRefresh(ops)) return false;
		const nextDoc = applyBoardOps(board.document, ops);
		syncVersionByBoardId = {
			...syncVersionByBoardId,
			[boardId]: version,
		};
		boards = boards.map((item) =>
			item.boardId === boardId
				? { ...item, document: nextDoc, error: null }
				: item,
		);
		return true;
	}

	async function drainRemoteRefresh(boardId: string) {
		// Still saving: leave queue intact for the commit's finally block.
		if (isBusy(boardId)) return;
		// One drain at a time per document. Concurrent callers just queue; the
		// active drain re-checks the queue before exiting.
		if (drainingDocuments.has(boardId)) return;
		drainingDocuments.add(boardId);
		try {
			let guard = 0;
			while (guard < 8) {
				guard += 1;
				if (isBusy(boardId)) return;

				// Snapshot and remove this document's queued events for this pass.
				const events = pendingRemoteEvents
					.filter((event) => event.boardId === boardId)
					.sort((a, b) => a.version - b.version);
				pendingRemoteEvents = pendingRemoteEvents.filter(
					(event) => event.boardId !== boardId,
				);

				let needsBootstrap = pendingRemoteBootstrap.has(boardId);
				pendingRemoteBootstrap.delete(boardId);

				// Events that failed contiguous apply are put back after bootstrap.
				let remainder: PendingRemoteEvent[] = [];
				if (!needsBootstrap) {
					for (let i = 0; i < events.length; i += 1) {
						const event = events[i];
						if (!event) continue;
						const ok = applyRemoteOpsLocally(boardId, event.version, event.ops);
						if (!ok) {
							needsBootstrap = true;
							remainder = events.slice(i);
							break;
						}
					}
				} else {
					remainder = events;
				}

				if (!needsBootstrap) {
					// Fresh events may have arrived while we applied ops.
					if (
						pendingRemoteEvents.some((e) => e.boardId === boardId) ||
						pendingRemoteBootstrap.has(boardId)
					) {
						continue;
					}
					return;
				}

				try {
					const bootstrap = await sdk
						.space(options.getSpaceId())
						.boards.inspect(boardId);
					applyBootstrap(boardId, bootstrap);
					const bootVersion = bootstrap.board.version;
					// Re-queue only events newer than the bootstrap; drop the rest.
					const newer = remainder.filter(
						(event) => event.version > bootVersion,
					);
					if (newer.length > 0) pendingRemoteEvents.push(...newer);
					pendingRemoteEvents = pendingRemoteEvents.filter(
						(event) => event.boardId !== boardId || event.version > bootVersion,
					);
				} catch (error) {
					// Put unapplied events back so a later drain can retry.
					if (remainder.length > 0) pendingRemoteEvents.push(...remainder);
					setError(
						boardId,
						error instanceof Error ? error.message : "Failed to sync board",
					);
					return;
				}
			}
		} finally {
			drainingDocuments.delete(boardId);
			// If the guard capped us (or events arrived as we exited), schedule
			// another pass. Concurrent callers that bounced on the draining set
			// will not retry themselves.
			const stillPending =
				pendingRemoteBootstrap.has(boardId) ||
				pendingRemoteEvents.some((event) => event.boardId === boardId);
			if (stillPending && !isBusy(boardId)) {
				queueMicrotask(() => {
					void drainRemoteRefresh(boardId);
				});
			}
		}
	}

	function renamePath(fromPath: string, toPath: string) {
		boards = boards.map((board) => {
			if (board.path === fromPath) return { ...board, path: toPath };
			if (board.path.startsWith(`${fromPath}/`)) {
				return {
					...board,
					path: `${toPath}${board.path.slice(fromPath.length)}`,
				};
			}
			return board;
		});
		if (activeBoardPath === fromPath) activeBoardPath = toPath;
		else if (activeBoardPath?.startsWith(`${fromPath}/`)) {
			activeBoardPath = `${toPath}${activeBoardPath.slice(fromPath.length)}`;
		}
	}

	function setBoardError(boardId: string, error: string) {
		boards = boards.map((board) =>
			board.boardId === boardId ? { ...board, saveError: error } : board,
		);
	}

	function setError(boardId: string, error: string) {
		setBoardError(boardId, error);
	}

	async function retryBoardSave(path = activeBoardPath) {
		const board = boards.find((item) => item.path === path);
		if (!board?.boardId || options.getReadonly?.()) return;
		boards = boards.map((item) =>
			item.path === path ? { ...item, saving: true, saveError: null } : item,
		);
		try {
			await flushPendingTransactions(board.boardId);
			boards = boards.map((item) =>
				item.path === path ? { ...item, saving: false, saveError: null } : item,
			);
		} catch (error) {
			boards = boards.map((item) =>
				item.path === path
					? {
							...item,
							saving: false,
							saveError: error instanceof Error ? error.message : "Sync failed",
						}
					: item,
			);
		}
	}

	function applyPlayback(playback: BoardPlaybackSnapshot) {
		boards = boards.map((item) =>
			item.boardId === playback.boardId && item.runtime
				? { ...item, runtime: { ...item.runtime, playback } }
				: item,
		);
	}

	function applyBootstrap(boardId: string, bootstrap: BoardBootstrap) {
		const board = boards.find((item) => item.boardId === boardId);
		if (!board || board.saving) return;
		syncVersionByBoardId = {
			...syncVersionByBoardId,
			[boardId]: bootstrap.board.version,
		};
		boards = boards.map((item) =>
			item.boardId === boardId
				? {
						...item,
						document: boardBootstrapToDocument(bootstrap),
						runtime: {
							effects: bootstrap.effects,
							sequences: bootstrap.sequences,
							clips: bootstrap.clips,
							playback: bootstrap.playback,
						},
						saveError: null,
					}
				: item,
		);
	}

	return {
		get board() {
			return boards.find((item) => item.path === activeBoardPath) ?? null;
		},
		get boards() {
			return boards;
		},
		get activeBoardPath() {
			return activeBoardPath;
		},
		openBoard,
		closeBoard,
		activateBoard,
		commitBoard,
		retryBoardSave,
		flushPendingTransactions,
		requestRemoteRefresh,
		requestRemoteOps,
		isOwnTransaction,
		renamePath,
		setError,
		applyPlayback,
		applyBootstrap,
	};
}
