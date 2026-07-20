import type {
	CanvasSemanticOp,
	SpaceFsFileResponse,
	SpaceFsPreparingFile,
} from "@neta-art/cohub";
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
import { resolveCanvasManifestText } from "$lib/canvas/canvas-manifest-text";
import type { CovasDocument } from "$lib/canvas/canvas-schema";
import { sdk } from "$lib/sdk";
import { tryResolveTextFileResponse } from "$lib/space-file-text";

type CanvasFileResponse = SpaceFsFileResponse | SpaceFsPreparingFile;

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
	let pendingFlush = false;
	let pendingFlushRequested = false;

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
					syncVersionByDocumentId = {
						...syncVersionByDocumentId,
						[documentId]: result.document.version,
					};
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
		const canvas = canvases.find((item) => item.path === activeCanvasPath);
		if (options.getReadonly?.() || !canvas?.documentId || ops.length === 0)
			return;
		const documentId = canvas.documentId;
		const savingPath = canvas.path;
		const txId = crypto.randomUUID();
		options.onMarkSavePending?.(savingPath);
		canvases = canvases.map((item) =>
			item.path === savingPath ? { ...item, saving: true, error: null } : item,
		);
		await writeCanvasPendingTransaction({
			spaceId: options.getSpaceId(),
			documentId,
			txId,
			baseVersion: syncVersionByDocumentId[documentId] ?? null,
			ops,
		});
		canvases = canvases.map((item) =>
			item.path === savingPath ? { ...item, document } : item,
		);
		try {
			await flushPendingTransactions(documentId);
			canvases = canvases.map((item) =>
				item.path === savingPath
					? { ...item, saving: false, error: null }
					: item,
			);
		} catch (error) {
			canvases = canvases.map((item) =>
				item.path === savingPath
					? {
							...item,
							saving: false,
							error:
								error instanceof Error
									? error.message
									: "Canvas changes are saved locally and will retry.",
						}
					: item,
			);
		} finally {
			options.onClearSavePendingSoon?.(savingPath);
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
			canvas.documentId === documentId ? { ...canvas, error } : canvas,
		);
	}

	function setError(documentId: string, error: string) {
		setCanvasError(documentId, error);
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
						error: null,
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
		flushPendingTransactions,
		renamePath,
		setError,
		applyBootstrap,
	};
}
