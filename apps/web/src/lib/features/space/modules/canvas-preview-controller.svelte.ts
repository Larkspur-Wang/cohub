import type { CanvasSemanticOp } from "@neta-art/cohub";
import {
	deleteCanvasPendingTransaction,
	listCanvasPendingTransactions,
	markCanvasPendingTransactionAttempt,
	writeCanvasPendingTransaction,
} from "$lib/cache/repositories/canvas-pending-tx-repo";
import {
	canvasBootstrapToDocument,
	parseCovasManifest,
} from "$lib/canvas/canvas-document";
import type { CovasDocument } from "$lib/canvas/canvas-schema";
import { sdk } from "$lib/sdk";

type CanvasFileResponse = unknown;

export type InlineCanvasPanelState = {
	path: string;
	documentId: string | null;
	document: CovasDocument | null;
	loading: boolean;
	saving: boolean;
	error: string | null;
};

type CanvasPreviewControllerOptions = {
	getSpaceId: () => string;
	getSourceKey: () => string;
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
	let canvas = $state<InlineCanvasPanelState | null>(null);
	let requestToken = $state(0);
	let syncVersion = $state<number | null>(null);
	let pendingFlush = false;
	let pendingFlushRequested = false;

	function isCurrent(token: number, path: string, sourceKey: string) {
		return (
			token === requestToken &&
			canvas?.path === path &&
			sourceKey === options.getSourceKey()
		);
	}

	async function openCanvas(path: string) {
		const sourceKey = options.getSourceKey();
		options.onOpenPanel?.();
		options.onBeforeOpenCanvas?.();
		const token = requestToken + 1;
		requestToken = token;
		canvas = {
			path,
			documentId: null,
			document: null,
			loading: true,
			saving: false,
			error: null,
		};
		try {
			const file = await options.readFile(path);
			if (!isCurrent(token, path, sourceKey)) return;
			if (
				!file ||
				typeof file !== "object" ||
				!("content" in file) ||
				(file as { kind?: unknown }).kind !== "text"
			) {
				throw new Error("Canvas manifest must be a text file.");
			}
			const manifest = parseCovasManifest(
				typeof (file as { content?: unknown }).content === "string"
					? (file as { content: string }).content
					: "",
			);
			if (!manifest) throw new Error("Canvas manifest is invalid.");
			const bootstrap = await sdk
				.space(options.getSpaceId())
				.canvas.bootstrap(manifest.documentId);
			if (!isCurrent(token, path, sourceKey)) return;
			syncVersion = bootstrap.document.version;
			canvas = {
				path,
				documentId: bootstrap.document.id,
				document: canvasBootstrapToDocument(bootstrap),
				loading: false,
				saving: false,
				error: null,
			};
			void flushPendingTransactions(bootstrap.document.id).catch((error) => {
				if (canvas?.documentId !== bootstrap.document.id) return;
				canvas = {
					...canvas,
					error:
						error instanceof Error
							? error.message
							: "Canvas changes are saved locally and will retry.",
				};
			});
		} catch (error) {
			if (!isCurrent(token, path, sourceKey)) return;
			canvas = {
				path,
				documentId: null,
				document: null,
				loading: false,
				saving: false,
				error: error instanceof Error ? error.message : "Failed to open canvas",
			};
		}
	}

	function closeCanvas() {
		requestToken += 1;
		canvas = null;
		options.onClosePanel?.();
	}

	async function flushPendingTransactions(documentId: string) {
		if (pendingFlush) {
			pendingFlushRequested = true;
			return;
		}
		pendingFlush = true;
		try {
			do {
				pendingFlushRequested = false;
				while (true) {
					const pending = await listCanvasPendingTransactions(
						options.getSpaceId(),
						documentId,
					);
					if (pending.length === 0) break;
					const tx = pending[0];
					if (!tx) break;
					await markCanvasPendingTransactionAttempt(tx);
					const result = await sdk
						.space(options.getSpaceId())
						.sendCanvasTransactionRealtime(documentId, {
							txId: tx.txId,
							baseVersion: tx.baseVersion,
							ops: tx.ops,
						});
					syncVersion = result.document.version;
					await deleteCanvasPendingTransaction({
						spaceId: options.getSpaceId(),
						documentId,
						txId: tx.txId,
					});
				}
			} while (pendingFlushRequested);
		} finally {
			pendingFlush = false;
		}
	}

	async function commitCanvas(
		document: CovasDocument,
		ops: CanvasSemanticOp[],
	) {
		if (!canvas?.documentId || ops.length === 0) return;
		const documentId = canvas.documentId;
		const savingPath = canvas.path;
		const txId = crypto.randomUUID();
		options.onMarkSavePending?.(savingPath);
		canvas.saving = true;
		canvas.error = null;
		await writeCanvasPendingTransaction({
			spaceId: options.getSpaceId(),
			documentId,
			txId,
			baseVersion: syncVersion,
			ops,
		});
		canvas = { ...canvas, document };
		try {
			await flushPendingTransactions(documentId);
			if (canvas) canvas = { ...canvas, saving: false, error: null };
		} catch (error) {
			if (canvas) {
				canvas = {
					...canvas,
					saving: false,
					error:
						error instanceof Error
							? error.message
							: "Canvas changes are saved locally and will retry.",
				};
			}
		} finally {
			options.onClearSavePendingSoon?.(savingPath);
		}
	}

	function renamePath(fromPath: string, toPath: string) {
		if (canvas?.path === fromPath) canvas = { ...canvas, path: toPath };
	}

	function setError(documentId: string, error: string) {
		if (canvas?.documentId !== documentId) return;
		canvas = { ...canvas, error };
	}

	function applyBootstrap(
		documentId: string,
		bootstrap: Parameters<typeof canvasBootstrapToDocument>[0],
	) {
		if (canvas?.documentId !== documentId || canvas.saving) return;
		syncVersion = bootstrap.document.version;
		canvas = {
			...canvas,
			document: canvasBootstrapToDocument(bootstrap),
			error: null,
		};
	}

	return {
		get canvas() {
			return canvas;
		},
		openCanvas,
		closeCanvas,
		commitCanvas,
		flushPendingTransactions,
		renamePath,
		setError,
		applyBootstrap,
	};
}
