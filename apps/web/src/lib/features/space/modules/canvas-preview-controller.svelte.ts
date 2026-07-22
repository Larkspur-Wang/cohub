import type {
	CanvasSemanticOp,
	SpaceFsFileResponse,
	SpaceFsPreparingFile,
} from "@neta-art/cohub";
import { CanvasTransactionError, HttpError } from "@neta-art/cohub";
import {
	deleteCanvasPendingTransaction,
	listCanvasPendingTransactions,
	markCanvasPendingTransactionAttempt,
	writeCanvasPendingTransaction,
} from "$lib/cache/repositories/canvas-pending-tx-repo";
import {
	applyCanvasOps,
	canvasBootstrapToDocument,
	parseCovasManifest,
} from "$lib/canvas/canvas-document";
import { resolveCanvasManifestText } from "$lib/canvas/canvas-manifest-text";
import type { CovasDocument } from "$lib/canvas/canvas-schema";
import { sdk } from "$lib/sdk";
import { tryResolveTextFileResponse } from "$lib/space-file-text";

type CanvasFileResponse = SpaceFsFileResponse | SpaceFsPreparingFile;

/** Cap on automatic conflict-rebase retries before surfacing an error. */
const MAX_CONFLICT_RECOVERY = 5;

export type InlineCanvasPanelState = {
	path: string;
	documentId: string | null;
	document: CovasDocument | null;
	loading: boolean;
	saving: boolean;
	error: string | null;
	saveError: string | null;
};

type CanvasPreviewControllerOptions = {
	getSpaceId: () => string;
	getSourceKey: () => string;
	getReadonly?: () => boolean;
	readFile: (path: string) => Promise<CanvasFileResponse>;
	onOpenPanel?: () => void;
	onClosePanel?: () => void;
	onBeforeOpenCanvas?: () => void;
	onMarkSavePending?: (path: string) => void;
	onClearSavePendingSoon?: (path: string) => void;
};

export function createCanvasPreviewController(
	options: CanvasPreviewControllerOptions,
) {
	let canvases = $state<InlineCanvasPanelState[]>([]);
	let activeCanvasPath = $state<string | null>(null);
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
		ops: CanvasSemanticOp[];
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
	 * re-commit durably writes a fresh transaction (see commitCanvas). This closes
	 * the loss window where a crash or canvas-close between "delete stale" and
	 * "re-commit" would otherwise discard uncommitted local changes.
	 */
	const pendingRecoveryCleanup = new Set<string>();

	/** A transaction was rejected as a version conflict (409) and can be rebased. */
	function isVersionConflict(error: unknown): boolean {
		if (error instanceof CanvasTransactionError) return error.isVersionConflict;
		if (error instanceof HttpError) return error.status === 409;
		return false;
	}

	function isCurrent(token: number, path: string, sourceKey: string) {
		const canvas = canvases.find((item) => item.path === path);
		return (
			token === requestTokenByPath[path] &&
			Boolean(canvas) &&
			sourceKey === options.getSourceKey()
		);
	}

	async function openCanvas(path: string) {
		const sourceKey = options.getSourceKey();
		options.onOpenPanel?.();
		options.onBeforeOpenCanvas?.();
		const token = (requestTokenByPath[path] ?? 0) + 1;
		requestTokenByPath = { ...requestTokenByPath, [path]: token };
		activeCanvasPath = path;
		const loadingCanvas: InlineCanvasPanelState = {
			path,
			documentId: null,
			document: null,
			loading: true,
			saving: false,
			error: null,
			saveError: null,
		};
		canvases = canvases.some((item) => item.path === path)
			? canvases.map((item) => (item.path === path ? loadingCanvas : item))
			: [...canvases, loadingCanvas];
		try {
			const rawFile = await options.readFile(path);
			if (!isCurrent(token, path, sourceKey)) return;
			if (!rawFile || typeof rawFile !== "object" || !("content" in rawFile)) {
				throw new Error(
					"Canvas manifest is being prepared. Retry in a moment.",
				);
			}
			const { file, error: hydrateError } =
				await tryResolveTextFileResponse(rawFile);
			if (!isCurrent(token, path, sourceKey)) return;
			if (hydrateError) throw new Error(hydrateError);
			// .covas is JSON text; tolerate legacy misclassified binary responses
			// (e.g. unknown MIME before the extension was registered).
			const content = resolveCanvasManifestText(file);
			if (content == null) {
				throw new Error("Canvas manifest must be a text file.");
			}
			const manifest = parseCovasManifest(content);
			if (!manifest) throw new Error("Canvas manifest is invalid.");
			const bootstrap = await sdk
				.space(options.getSpaceId())
				.canvas.bootstrap(manifest.documentId);
			if (!isCurrent(token, path, sourceKey)) return;
			syncVersionByDocumentId = {
				...syncVersionByDocumentId,
				[bootstrap.document.id]: bootstrap.document.version,
			};
			canvases = canvases.map((item) =>
				item.path === path
					? {
							path,
							documentId: bootstrap.document.id,
							document: canvasBootstrapToDocument(bootstrap),
							loading: false,
							saving: false,
							error: null,
							saveError: null,
						}
					: item,
			);
			if (!options.getReadonly?.()) {
				void flushPendingTransactions(bootstrap.document.id).catch((error) => {
					setCanvasError(
						bootstrap.document.id,
						error instanceof Error
							? error.message
							: "Canvas changes are saved locally and will retry.",
					);
				});
			}
		} catch (error) {
			if (!isCurrent(token, path, sourceKey)) return;
			canvases = canvases.map((item) =>
				item.path === path
					? {
							path,
							documentId: null,
							document: null,
							loading: false,
							saving: false,
							error:
								error instanceof Error
									? error.message
									: "Failed to open canvas",
							saveError: null,
						}
					: item,
			);
		}
	}

	function closeCanvas(path = activeCanvasPath) {
		if (!path) return;
		requestTokenByPath = {
			...requestTokenByPath,
			[path]: (requestTokenByPath[path] ?? 0) + 1,
		};
		const index = canvases.findIndex((item) => item.path === path);
		const nextCanvases = canvases.filter((item) => item.path !== path);
		canvases = nextCanvases;
		if (activeCanvasPath === path)
			activeCanvasPath =
				nextCanvases[Math.max(0, index - 1)]?.path ??
				nextCanvases[0]?.path ??
				null;
		if (nextCanvases.length === 0) options.onClosePanel?.();
	}

	function activateCanvas(path: string) {
		if (!canvases.some((item) => item.path === path)) return;
		activeCanvasPath = path;
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
						const pending = await listCanvasPendingTransactions(
							options.getSpaceId(),
							documentId,
						);
						if (pending.length === 0) break;
						const tx = pending[0];
						if (!tx) break;
						await markCanvasPendingTransactionAttempt(tx);
						try {
							const result = await sdk
								.space(options.getSpaceId())
								.sendCanvasTransactionRealtime(documentId, {
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
							await deleteCanvasPendingTransaction({
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
	 * NOT deleted here — they are removed in commitCanvas only after the fresh
	 * rebase transaction is durably written, so local changes survive a crash or
	 * canvas-close mid-recovery (the stale txs simply replay and re-recover).
	 */
	async function recoverFromConflict(documentId: string) {
		const bootstrap = await sdk
			.space(options.getSpaceId())
			.canvas.bootstrap(documentId);
		syncVersionByDocumentId = {
			...syncVersionByDocumentId,
			[documentId]: bootstrap.document.version,
		};
		// Mark recovery in flight; commitCanvas performs the stale-tx cleanup once
		// the fresh rebase transaction is persisted.
		pendingRecoveryCleanup.add(documentId);
		// Push the remote document to the editor (clearing `saving` so it is
		// accepted); the rebase + re-commit happens inside the editor.
		canvases = canvases.map((item) =>
			item.documentId === documentId
				? {
						...item,
						document: canvasBootstrapToDocument(bootstrap),
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
		const remaining = await listCanvasPendingTransactions(
			options.getSpaceId(),
			documentId,
		);
		for (const other of remaining) {
			if (other.txId === keepTxId) continue;
			await deleteCanvasPendingTransaction({
				spaceId: options.getSpaceId(),
				documentId,
				txId: other.txId,
			});
		}
	}

	async function commitCanvas(
		document: CovasDocument,
		ops: CanvasSemanticOp[],
	) {
		const canvas = canvases.find((item) => item.path === activeCanvasPath);
		if (options.getReadonly?.() || !canvas?.documentId) return;
		const documentId = canvas.documentId;
		const savingPath = canvas.path;
		const txId = crypto.randomUUID();
		// A recovery re-commit with no resulting ops still must clear the stale
		// pending txs (their changes are already reflected server-side).
		if (ops.length === 0) {
			if (pendingRecoveryCleanup.has(documentId))
				await cleanupStaleTransactions(documentId, txId);
			return;
		}
		options.onMarkSavePending?.(savingPath);
		canvases = canvases.map((item) =>
			item.path === savingPath
				? { ...item, saving: true, saveError: null }
				: item,
		);
		try {
			await writeCanvasPendingTransaction({
				spaceId: options.getSpaceId(),
				documentId,
				txId,
				baseVersion: syncVersionByDocumentId[documentId] ?? null,
				ops,
			});
		} catch (error) {
			canvases = canvases.map((item) =>
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
		canvases = canvases.map((item) =>
			item.path === savingPath ? { ...item, document } : item,
		);
		try {
			await flushPendingTransactions(documentId);
			canvases = canvases.map((item) =>
				item.path === savingPath
					? { ...item, saving: false, saveError: null }
					: item,
			);
		} catch (error) {
			canvases = canvases.map((item) =>
				item.path === savingPath
					? {
							...item,
							saving: false,
							saveError:
								error instanceof Error
									? error.message
									: "Canvas changes are saved locally and will retry.",
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
		const canvas = canvases.find((item) => item.documentId === documentId);
		return Boolean(canvas?.saving || pendingFlushByDocumentId.has(documentId));
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
		event: { version: number; txId: string; ops: CanvasSemanticOp[] },
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
		ops: CanvasSemanticOp[],
	): boolean {
		const canvas = canvases.find((item) => item.documentId === documentId);
		if (!canvas || canvas.saving || !canvas.document) return false;
		const localVersion = syncVersionByDocumentId[documentId] ?? null;
		if (localVersion == null) return false;
		if (version <= localVersion) return true; // already applied / stale
		if (version !== localVersion + 1) return false; // gap → bootstrap
		const nextDoc = applyCanvasOps(canvas.document, ops);
		syncVersionByDocumentId = {
			...syncVersionByDocumentId,
			[documentId]: version,
		};
		canvases = canvases.map((item) =>
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
						.canvas.bootstrap(documentId);
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
						error instanceof Error ? error.message : "Failed to sync canvas",
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
		canvases = canvases.map((canvas) => {
			if (canvas.path === fromPath) return { ...canvas, path: toPath };
			if (canvas.path.startsWith(`${fromPath}/`)) {
				return {
					...canvas,
					path: `${toPath}${canvas.path.slice(fromPath.length)}`,
				};
			}
			return canvas;
		});
		if (activeCanvasPath === fromPath) activeCanvasPath = toPath;
		else if (activeCanvasPath?.startsWith(`${fromPath}/`)) {
			activeCanvasPath = `${toPath}${activeCanvasPath.slice(fromPath.length)}`;
		}
	}

	function setCanvasError(documentId: string, error: string) {
		canvases = canvases.map((canvas) =>
			canvas.documentId === documentId
				? { ...canvas, saveError: error }
				: canvas,
		);
	}

	function setError(documentId: string, error: string) {
		setCanvasError(documentId, error);
	}

	async function retryCanvasSave(path = activeCanvasPath) {
		const canvas = canvases.find((item) => item.path === path);
		if (!canvas?.documentId || options.getReadonly?.()) return;
		canvases = canvases.map((item) =>
			item.path === path ? { ...item, saving: true, saveError: null } : item,
		);
		try {
			await flushPendingTransactions(canvas.documentId);
			canvases = canvases.map((item) =>
				item.path === path ? { ...item, saving: false, saveError: null } : item,
			);
		} catch (error) {
			canvases = canvases.map((item) =>
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
		bootstrap: Parameters<typeof canvasBootstrapToDocument>[0],
	) {
		const canvas = canvases.find((item) => item.documentId === documentId);
		if (!canvas || canvas.saving) return;
		syncVersionByDocumentId = {
			...syncVersionByDocumentId,
			[documentId]: bootstrap.document.version,
		};
		canvases = canvases.map((item) =>
			item.documentId === documentId
				? {
						...item,
						document: canvasBootstrapToDocument(bootstrap),
						saveError: null,
					}
				: item,
		);
	}

	return {
		get canvas() {
			return canvases.find((item) => item.path === activeCanvasPath) ?? null;
		},
		get canvases() {
			return canvases;
		},
		get activeCanvasPath() {
			return activeCanvasPath;
		},
		openCanvas,
		closeCanvas,
		activateCanvas,
		commitCanvas,
		retryCanvasSave,
		flushPendingTransactions,
		requestRemoteRefresh,
		requestRemoteOps,
		isOwnTransaction,
		renamePath,
		setError,
		applyBootstrap,
	};
}
