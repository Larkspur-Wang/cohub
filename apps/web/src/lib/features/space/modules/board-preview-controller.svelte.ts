import type {
	BoardSemanticOp,
	SpaceFsFileResponse,
	SpaceFsPreparingFile,
} from "@neta-art/cohub";
import { BoardTransactionError, HttpError } from "@neta-art/cohub";
import {
	applyBoardOps,
	boardBootstrapToDocument,
	parseBoardManifest,
} from "$lib/board/board-document";
import { resolveBoardManifestText } from "$lib/board/board-manifest-text";
import type { BoardDocument } from "$lib/board/board-schema";
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
	documentId: string | null;
	document: BoardDocument | null;
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
	let syncVersionByDocumentId = $state<Record<string, number | null>>({});
	const pendingFlushByDocumentId = new Map<string, Promise<void>>();
	const pendingFlushRequested = new Set<string>();
	/** Conflict-recovery attempts per document, to bound rebase retries. */
	let conflictAttemptsByDocumentId: Record<string, number> = {};
	/**
	 * Remote events deferred while a save is in flight. Never dropped: drained in
	 * version order after the commit settles. When the queued sequence is
	 * contiguous with the local baseline we apply ops incrementally; any gap
	 * falls back to a full bootstrap.
	 */
	type PendingRemoteEvent = {
		documentId: string;
		version: number;
		txId: string;
		ops: BoardSemanticOp[];
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
		if (error instanceof HttpError) return error.status === 409;
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
			documentId: null,
			document: null,
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
				.boards.bootstrap(manifest.documentId);
			if (!isCurrent(token, path, sourceKey)) return;
			syncVersionByDocumentId = {
				...syncVersionByDocumentId,
				[bootstrap.document.id]: bootstrap.document.version,
			};
			boards = boards.map((item) =>
				item.path === path
					? {
							path,
							documentId: bootstrap.document.id,
							document: boardBootstrapToDocument(bootstrap),
							loading: false,
							saving: false,
							error: null,
							saveError: null,
						}
					: item,
			);
			if (!options.getReadonly?.()) {
				void flushPendingTransactions(bootstrap.document.id).catch((error) => {
					setBoardError(
						bootstrap.document.id,
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
							documentId: null,
							document: null,
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

	function flushPendingTransactions(documentId: string): Promise<void> {
		const activeFlush = pendingFlushByDocumentId.get(documentId);
		if (activeFlush) {
			pendingFlushRequested.add(documentId);
			return activeFlush;
		}
		const flush = (async () => {
			try {
				do {
					pendingFlushRequested.delete(documentId);
					while (true) {
						const pending = await listBoardPendingTransactions(
							options.getSpaceId(),
							documentId,
						);
						if (pending.length === 0) break;
						const tx = pending[0];
						if (!tx) break;
						await markBoardPendingTransactionAttempt(tx);
						try {
							const result = await sdk
								.space(options.getSpaceId())
								.sendBoardTransactionRealtime(documentId, {
									txId: tx.txId,
									baseVersion: tx.baseVersion,
									ops: tx.ops,
								});
							syncVersionByDocumentId = {
								...syncVersionByDocumentId,
								[documentId]: result.document.version,
							};
							// A successful commit resets the conflict-recovery budget.
							delete conflictAttemptsByDocumentId[documentId];
							// Remember our own txId so the echoed realtime event is skipped.
							ownTxIds.add(tx.txId);
							if (ownTxIds.size > 256) {
								const oldest = ownTxIds.values().next().value;
								if (oldest) ownTxIds.delete(oldest);
							}
							await deleteBoardPendingTransaction({
								spaceId: options.getSpaceId(),
								documentId,
								txId: tx.txId,
							});
						} catch (error) {
							const attempts = conflictAttemptsByDocumentId[documentId] ?? 0;
							if (
								isVersionConflict(error) &&
								attempts < MAX_CONFLICT_RECOVERY
							) {
								// A recovery is already in flight: this stale tx will be superseded
								// by the rebase re-commit, so stop rather than re-recovering.
								if (pendingRecoveryCleanup.has(documentId)) break;
								conflictAttemptsByDocumentId[documentId] = attempts + 1;
								// Rebase onto the server truth and restart the loop; the editor
								// re-commits a fresh transaction with the correct base version.
								await recoverFromConflict(documentId);
								break;
							}
							throw error;
						}
					}
				} while (pendingFlushRequested.delete(documentId));
			} finally {
				pendingFlushByDocumentId.delete(documentId);
			}
		})();
		pendingFlushByDocumentId.set(documentId, flush);
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
	async function recoverFromConflict(documentId: string) {
		const bootstrap = await sdk
			.space(options.getSpaceId())
			.boards.bootstrap(documentId);
		syncVersionByDocumentId = {
			...syncVersionByDocumentId,
			[documentId]: bootstrap.document.version,
		};
		// Mark recovery in flight; commitBoard performs the stale-tx cleanup once
		// the fresh rebase transaction is persisted.
		pendingRecoveryCleanup.add(documentId);
		// Push the remote document to the editor (clearing `saving` so it is
		// accepted); the rebase + re-commit happens inside the editor.
		boards = boards.map((item) =>
			item.documentId === documentId
				? {
						...item,
						document: boardBootstrapToDocument(bootstrap),
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
	async function cleanupStaleTransactions(
		documentId: string,
		keepTxId: string,
	) {
		pendingRecoveryCleanup.delete(documentId);
		const remaining = await listBoardPendingTransactions(
			options.getSpaceId(),
			documentId,
		);
		for (const other of remaining) {
			if (other.txId === keepTxId) continue;
			await deleteBoardPendingTransaction({
				spaceId: options.getSpaceId(),
				documentId,
				txId: other.txId,
			});
		}
	}

	async function commitBoard(document: BoardDocument, ops: BoardSemanticOp[]) {
		const board = boards.find((item) => item.path === activeBoardPath);
		if (options.getReadonly?.() || !board?.documentId) return;
		const documentId = board.documentId;
		const savingPath = board.path;
		const txId = crypto.randomUUID();
		// A recovery re-commit with no resulting ops still must clear the stale
		// pending txs (their changes are already reflected server-side).
		if (ops.length === 0) {
			if (pendingRecoveryCleanup.has(documentId))
				await cleanupStaleTransactions(documentId, txId);
			return;
		}
		options.onMarkSavePending?.(savingPath);
		boards = boards.map((item) =>
			item.path === savingPath
				? { ...item, saving: true, saveError: null }
				: item,
		);
		try {
			await writeBoardPendingTransaction({
				spaceId: options.getSpaceId(),
				documentId,
				txId,
				baseVersion: syncVersionByDocumentId[documentId] ?? null,
				ops,
			});
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
			void drainRemoteRefresh(documentId);
			throw error;
		}
		// The fresh (rebase) transaction is now durable; it supersedes any stale
		// pending txs from an in-flight recovery, so they can be safely removed.
		if (pendingRecoveryCleanup.has(documentId))
			await cleanupStaleTransactions(documentId, txId);
		boards = boards.map((item) =>
			item.path === savingPath ? { ...item, document } : item,
		);
		try {
			await flushPendingTransactions(documentId);
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
			void drainRemoteRefresh(documentId);
		}
	}

	/** True if this txId was committed by this client (an echo to skip). */
	function isOwnTransaction(txId: unknown): boolean {
		return typeof txId === "string" && ownTxIds.has(txId);
	}

	function isBusy(documentId: string): boolean {
		const board = boards.find((item) => item.documentId === documentId);
		return Boolean(board?.saving || pendingFlushByDocumentId.has(documentId));
	}

	/**
	 * Full-document remote refresh (bootstrap). Used as a fallback when ops are
	 * missing or the version sequence has a gap.
	 */
	function requestRemoteRefresh(documentId: string) {
		pendingRemoteBootstrap.add(documentId);
		if (isBusy(documentId)) return;
		void drainRemoteRefresh(documentId);
	}

	/**
	 * Prefer incremental ops application. Falls back to bootstrap on gaps.
	 */
	function requestRemoteOps(
		documentId: string,
		event: { version: number; txId: string; ops: BoardSemanticOp[] },
	) {
		pendingRemoteEvents.push({
			documentId,
			version: event.version,
			txId: event.txId,
			ops: event.ops,
		});
		if (isBusy(documentId)) return;
		void drainRemoteRefresh(documentId);
	}

	function applyRemoteOpsLocally(
		documentId: string,
		version: number,
		ops: BoardSemanticOp[],
	): boolean {
		const board = boards.find((item) => item.documentId === documentId);
		if (!board || board.saving || !board.document) return false;
		const localVersion = syncVersionByDocumentId[documentId] ?? null;
		if (localVersion == null) return false;
		if (version <= localVersion) return true; // already applied / stale
		if (version !== localVersion + 1) return false; // gap → bootstrap
		const nextDoc = applyBoardOps(board.document, ops);
		syncVersionByDocumentId = {
			...syncVersionByDocumentId,
			[documentId]: version,
		};
		boards = boards.map((item) =>
			item.documentId === documentId
				? { ...item, document: nextDoc, error: null }
				: item,
		);
		return true;
	}

	async function drainRemoteRefresh(documentId: string) {
		// Still saving: leave queue intact for the commit's finally block.
		if (isBusy(documentId)) return;
		// One drain at a time per document. Concurrent callers just queue; the
		// active drain re-checks the queue before exiting.
		if (drainingDocuments.has(documentId)) return;
		drainingDocuments.add(documentId);
		try {
			let guard = 0;
			while (guard < 8) {
				guard += 1;
				if (isBusy(documentId)) return;

				// Snapshot and remove this document's queued events for this pass.
				const events = pendingRemoteEvents
					.filter((event) => event.documentId === documentId)
					.sort((a, b) => a.version - b.version);
				pendingRemoteEvents = pendingRemoteEvents.filter(
					(event) => event.documentId !== documentId,
				);

				let needsBootstrap = pendingRemoteBootstrap.has(documentId);
				pendingRemoteBootstrap.delete(documentId);

				// Events that failed contiguous apply are put back after bootstrap.
				let remainder: PendingRemoteEvent[] = [];
				if (!needsBootstrap) {
					for (let i = 0; i < events.length; i += 1) {
						const event = events[i];
						if (!event) continue;
						const ok = applyRemoteOpsLocally(
							documentId,
							event.version,
							event.ops,
						);
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
						pendingRemoteEvents.some((e) => e.documentId === documentId) ||
						pendingRemoteBootstrap.has(documentId)
					) {
						continue;
					}
					return;
				}

				try {
					const bootstrap = await sdk
						.space(options.getSpaceId())
						.boards.bootstrap(documentId);
					applyBootstrap(documentId, bootstrap);
					const bootVersion = bootstrap.document.version;
					// Re-queue only events newer than the bootstrap; drop the rest.
					const newer = remainder.filter(
						(event) => event.version > bootVersion,
					);
					if (newer.length > 0) pendingRemoteEvents.push(...newer);
					pendingRemoteEvents = pendingRemoteEvents.filter(
						(event) =>
							event.documentId !== documentId || event.version > bootVersion,
					);
				} catch (error) {
					// Put unapplied events back so a later drain can retry.
					if (remainder.length > 0) pendingRemoteEvents.push(...remainder);
					setError(
						documentId,
						error instanceof Error ? error.message : "Failed to sync board",
					);
					return;
				}
			}
		} finally {
			drainingDocuments.delete(documentId);
			// If the guard capped us (or events arrived as we exited), schedule
			// another pass. Concurrent callers that bounced on the draining set
			// will not retry themselves.
			const stillPending =
				pendingRemoteBootstrap.has(documentId) ||
				pendingRemoteEvents.some((event) => event.documentId === documentId);
			if (stillPending && !isBusy(documentId)) {
				queueMicrotask(() => {
					void drainRemoteRefresh(documentId);
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

	function setBoardError(documentId: string, error: string) {
		boards = boards.map((board) =>
			board.documentId === documentId ? { ...board, saveError: error } : board,
		);
	}

	function setError(documentId: string, error: string) {
		setBoardError(documentId, error);
	}

	async function retryBoardSave(path = activeBoardPath) {
		const board = boards.find((item) => item.path === path);
		if (!board?.documentId || options.getReadonly?.()) return;
		boards = boards.map((item) =>
			item.path === path ? { ...item, saving: true, saveError: null } : item,
		);
		try {
			await flushPendingTransactions(board.documentId);
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

	function applyBootstrap(
		documentId: string,
		bootstrap: Parameters<typeof boardBootstrapToDocument>[0],
	) {
		const board = boards.find((item) => item.documentId === documentId);
		if (!board || board.saving) return;
		syncVersionByDocumentId = {
			...syncVersionByDocumentId,
			[documentId]: bootstrap.document.version,
		};
		boards = boards.map((item) =>
			item.documentId === documentId
				? {
						...item,
						document: boardBootstrapToDocument(bootstrap),
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
		applyBootstrap,
	};
}
