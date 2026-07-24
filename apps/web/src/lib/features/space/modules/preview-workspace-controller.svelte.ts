import type {
	WorkspacePreviewKind,
	WorkspacePreviewRef,
} from "./workspace-preview-route";
import { isValidPortKey } from "./workspace-preview-route";

export type PreviewTabKind = WorkspacePreviewKind;

type FileTabLike = {
	path: string;
	response: unknown;
	draft: string;
};

type BoardTabLike = {
	path: string;
	saving: boolean;
};

type PortTabLike = {
	port: string;
	url: string;
};

type PreviewWorkspaceOptions = {
	getFileTabs: () => FileTabLike[];
	getActiveFilePath: () => string | null;
	getBoardTabs: () => BoardTabLike[];
	getActiveBoardPath: () => string | null;
	getPortTabs: () => PortTabLike[];
	getActivePort: () => string | null;
	openFile: (
		path: string,
		options?: { preserveHistory?: boolean; position?: unknown },
	) => Promise<void>;
	activateFile: (path: string) => void;
	closeFile: (path?: string | null, skipConfirm?: boolean) => void;
	goBackFile: () => Promise<string | null>;
	openBoard: (path: string) => Promise<void>;
	activateBoard: (path: string) => void;
	closeBoard: (path?: string | null) => void;
	openPort: (
		port: string,
		url: string,
		options?: { autoOpened?: boolean },
	) => void;
	activatePort: (port: string) => void;
	closePort: (port?: string | null) => void;
	getPortEndpointUrl: (port: string) => string | null | undefined;
	syncUrl: (ref: WorkspacePreviewRef | null, replace?: boolean) => void;
	onBudgetCleanup?: () => void;
	weightLimit?: number;
};

const DEFAULT_WEIGHT_LIMIT = 16;

function asFileResponse(response: unknown): {
	kind?: string;
	content?: string;
} | null {
	if (!response || typeof response !== "object") return null;
	return response as { kind?: string; content?: string };
}

function isBinaryFileTab(tab: FileTabLike) {
	const response = asFileResponse(tab.response);
	return response?.kind === "binary";
}

function isDirtyFileTab(tab: FileTabLike) {
	const response = asFileResponse(tab.response);
	if (!response || typeof response.content !== "string") return false;
	return tab.draft !== response.content;
}

/**
 * Single active-tab coordinator over file/board/port domain controllers.
 * Owns: active kind, access order, budget, URL sync, open/activate/close.
 * Does not own: file drafts, board docs, port endpoints (domain controllers do).
 */
export function createPreviewWorkspaceController(
	options: PreviewWorkspaceOptions,
) {
	let activeKind = $state<PreviewTabKind | null>(null);
	let accessedAt = $state<Record<string, number>>({});
	const weightLimit = options.weightLimit ?? DEFAULT_WEIGHT_LIMIT;

	function tabId(kind: PreviewTabKind, key: string) {
		return `${kind}:${key}`;
	}

	function touch(kind: PreviewTabKind, key: string) {
		accessedAt = { ...accessedAt, [tabId(kind, key)]: Date.now() };
	}

	function currentRef(): WorkspacePreviewRef | null {
		if (activeKind === "file") {
			const path = options.getActiveFilePath();
			return path ? { kind: "file", key: path } : null;
		}
		if (activeKind === "board") {
			const path = options.getActiveBoardPath();
			return path ? { kind: "board", key: path } : null;
		}
		if (activeKind === "port") {
			const port = options.getActivePort();
			return port ? { kind: "port", key: port } : null;
		}
		// Fallback if kind drifted but a surface is still open.
		const filePath = options.getActiveFilePath();
		if (filePath) return { kind: "file", key: filePath };
		const boardPath = options.getActiveBoardPath();
		if (boardPath) return { kind: "board", key: boardPath };
		const port = options.getActivePort();
		if (port) return { kind: "port", key: port };
		return null;
	}

	function resolveKind(): PreviewTabKind | null {
		if (activeKind === "port" && options.getActivePort()) return "port";
		if (activeKind === "board" && options.getActiveBoardPath()) return "board";
		if (activeKind === "file" && options.getActiveFilePath()) return "file";
		if (options.getActiveFilePath()) return "file";
		if (options.getActiveBoardPath()) return "board";
		if (options.getActivePort()) return "port";
		return null;
	}

	function enforceBudget() {
		const candidates = [
			...options.getFileTabs().map((tab) => ({
				kind: "file" as const,
				key: tab.path,
				weight: isBinaryFileTab(tab) ? 2 : 1,
				protected: isDirtyFileTab(tab),
			})),
			...options.getBoardTabs().map((tab) => ({
				kind: "board" as const,
				key: tab.path,
				weight: 2,
				protected: tab.saving,
			})),
			...options.getPortTabs().map((tab) => ({
				kind: "port" as const,
				key: tab.port,
				weight: 3,
				protected: false,
			})),
		];
		let total = candidates.reduce((sum, tab) => sum + tab.weight, 0);
		if (total <= weightLimit) return;
		const removable = candidates
			.filter((tab) => !tab.protected)
			.sort(
				(a, b) =>
					(accessedAt[tabId(a.kind, a.key)] ?? 0) -
					(accessedAt[tabId(b.kind, b.key)] ?? 0),
			);
		let closed = 0;
		for (const tab of removable) {
			if (total <= weightLimit) break;
			if (tab.kind === "file") options.closeFile(tab.key, true);
			else if (tab.kind === "board") options.closeBoard(tab.key);
			else options.closePort(tab.key);
			total -= tab.weight;
			closed += 1;
		}
		if (closed > 0) {
			activeKind = resolveKind();
			options.syncUrl(currentRef(), true);
			options.onBudgetCleanup?.();
		}
	}

	async function openFile(
		path: string,
		opts: {
			syncUrl?: boolean;
			preserveHistory?: boolean;
			position?: unknown;
		} = {},
	) {
		const syncUrl = opts.syncUrl ?? true;
		// Capture before flipping activeKind so first open pushes history,
		// subsequent tab switches replace.
		const hadPreview = Boolean(currentRef());
		activeKind = "file";
		touch("file", path);
		// Sync URL before awaiting domain I/O. Otherwise the route-hydration
		// effect can observe a brief no-preview URL while UI already opened
		// a file and tear the panel down (click → composer focus only).
		if (syncUrl) {
			options.syncUrl({ kind: "file", key: path }, hadPreview);
		}
		await options.openFile(path, {
			preserveHistory: opts.preserveHistory,
			position: opts.position,
		});
		enforceBudget();
		// Re-assert URL if budget eviction / concurrent open changed active tab.
		if (syncUrl) {
			const ref = currentRef();
			if (ref) options.syncUrl(ref, true);
		}
	}

	async function openBoard(path: string, opts: { syncUrl?: boolean } = {}) {
		const syncUrl = opts.syncUrl ?? true;
		const hadPreview = Boolean(currentRef());
		activeKind = "board";
		touch("board", path);
		if (syncUrl) {
			options.syncUrl({ kind: "board", key: path }, hadPreview);
		}
		await options.openBoard(path);
		enforceBudget();
		if (syncUrl) {
			const ref = currentRef();
			if (ref) options.syncUrl(ref, true);
		}
	}

	function openPort(
		port: string,
		url: string,
		opts: { autoOpened?: boolean; syncUrl?: boolean } = {},
	) {
		if (!isValidPortKey(port)) return;
		const syncUrl = opts.syncUrl ?? true;
		const hadPreview = Boolean(currentRef());
		activeKind = "port";
		touch("port", port);
		if (syncUrl) {
			options.syncUrl({ kind: "port", key: port }, hadPreview);
		}
		options.openPort(port, url, { autoOpened: opts.autoOpened });
		enforceBudget();
		if (syncUrl) {
			const ref = currentRef();
			if (ref) options.syncUrl(ref, true);
		}
	}

	function activate(kind: PreviewTabKind, key: string, syncUrl = true) {
		activeKind = kind;
		touch(kind, key);
		if (kind === "file") options.activateFile(key);
		else if (kind === "board") options.activateBoard(key);
		else options.activatePort(key);
		if (syncUrl) options.syncUrl({ kind, key }, true);
	}

	function close(
		kind: PreviewTabKind,
		key?: string | null,
		skipConfirm = false,
	) {
		if (kind === "file") options.closeFile(key, skipConfirm);
		else if (kind === "board") options.closeBoard(key);
		else options.closePort(key);
		activeKind = resolveKind();
		options.syncUrl(currentRef(), true);
	}

	function closeActive() {
		const ref = currentRef();
		if (!ref) return;
		close(ref.kind, ref.key);
	}

	function closeAll(opts: { syncUrl?: boolean } = {}) {
		const syncUrl = opts.syncUrl ?? true;
		activeKind = null;
		for (const tab of [...options.getFileTabs()]) {
			options.closeFile(tab.path, true);
		}
		for (const tab of [...options.getBoardTabs()]) {
			options.closeBoard(tab.path);
		}
		for (const tab of [...options.getPortTabs()]) {
			options.closePort(tab.port);
		}
		if (syncUrl) options.syncUrl(null, true);
	}

	async function goBackFile() {
		const previous = await options.goBackFile();
		if (!previous) return null;
		activeKind = "file";
		touch("file", previous);
		options.syncUrl({ kind: "file", key: previous }, true);
		return previous;
	}

	function hydrateFromRoute(ref: WorkspacePreviewRef | null) {
		if (!ref) {
			closeAll({ syncUrl: false });
			return { ok: true as const };
		}
		const current = currentRef();
		if (current && current.kind === ref.kind && current.key === ref.key) {
			activeKind = ref.kind;
			touch(ref.kind, ref.key);
			return { ok: true as const };
		}
		if (ref.kind === "file") {
			void openFile(ref.key, { syncUrl: false });
			return { ok: true as const };
		}
		if (ref.kind === "board") {
			void openBoard(ref.key, { syncUrl: false });
			return { ok: true as const };
		}
		// port: only open when a trusted endpoint URL is available
		const url = options.getPortEndpointUrl(ref.key);
		if (!url)
			return { ok: false as const, reason: "port-endpoint-pending" as const };
		openPort(ref.key, url, { syncUrl: false });
		return { ok: true as const };
	}

	function setActiveKind(kind: PreviewTabKind | null) {
		activeKind = kind;
	}

	return {
		get activeKind() {
			return resolveKind();
		},
		get activeKindState() {
			return activeKind;
		},
		setActiveKind,
		currentRef,
		touch,
		openFile,
		openBoard,
		openPort,
		activate,
		close,
		closeActive,
		closeAll,
		goBackFile,
		hydrateFromRoute,
		enforceBudget,
	};
}
