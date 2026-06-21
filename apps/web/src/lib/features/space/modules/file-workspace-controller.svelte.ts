import type { SpaceFsEntry, SpaceFsFileResponse } from "@neta-art/cohub";
import { HttpError } from "@neta-art/cohub";
import { goto } from "$app/navigation";
import {
	canvasItemToNode,
	createEmptyCovasDocument,
} from "$lib/canvas/canvas-document";
import { ensureCovasExtension, isCovasFile } from "$lib/canvas/canvas-file";
import { sdk } from "$lib/sdk";
import {
	buildSpaceFileDownloadUrl,
	downloadFileResponse,
	downloadSpaceFile,
} from "$lib/space-file-download";
import type { SpaceFsNode } from "$lib/space-fs";
import { buildSpaceFileRoute } from "$lib/space-routes";
import {
	clearCachedSpaceFsSubtree,
	fetchSpaceFsDirWithCache,
	getCachedSpaceFsDir,
	patchCachedSpaceFsDir,
} from "$lib/stores/space-fs-cache";
import {
	buildFsEntry,
	getParentDirPath,
	hasRenderedFilePreview,
	isHtmlPath,
	isMarkdownPath,
	makeFsNodes,
	replaceNodeChildren,
	updateNodeState,
} from "./file-workspace-utils";

export type ActiveFsSource =
	| { kind: "live" }
	| { kind: "checkpoint"; checkpointId: string };

export type FileWorkspaceInlineFile = {
	response: SpaceFsFileResponse | null;
	draft: string;
	path: string;
	loading: boolean;
	saving: boolean;
	error: string | null;
	tooLarge: boolean;
};

type FileWorkspaceControllerOptions = {
	getSpaceId: () => string;
	getActiveFsSource: () => ActiveFsSource;
	getActiveFsSourceKey: () => string;
	getRouteFilePath: () => string | null;
	getCanEditFiles: () => boolean;
	getActiveFsReadonly: () => boolean;
	getSpaceHasMinimalAccess: () => boolean;
	onCloseRouteFile: () => void;
	onOpenInlineCanvas: (path: string) => Promise<void>;
	onCloseInlineCanvas: () => void;
	onRenameInlineCanvas?: (fromPath: string, toPath: string) => void;
	onOpenInlinePort: (
		port: string,
		url: string,
		options?: { autoOpened?: boolean },
	) => void;
	onCloseInlinePort: () => void;
	onClosePreviewFocusMode: () => void;
	onEnsurePreviewPanelFits: () => void;
};

export function createFileWorkspaceController(
	options: FileWorkspaceControllerOptions,
) {
	let fileTree = $state<SpaceFsNode[]>([]);
	let fileTreeBySource = $state<Record<string, SpaceFsNode[]>>({});
	let fileTreeSourceKey = $state("live");
	let fileTreeLoading = $state(false);
	let fileTreeError = $state<string | null>(null);
	let fileTreeRequestToken = $state(0);
	let directoryLoadTokenByPath = $state<Record<string, number>>({});
	let openFile = $state<SpaceFsFileResponse | null>(null);
	let openFileDraft = $state("");
	let openFileLoading = $state(false);
	let openFileSaving = $state(false);
	let openFileError = $state<string | null>(null);
	let openFileTooLarge = $state(false);
	let inlineFile = $state<FileWorkspaceInlineFile | null>(null);
	let inlineFileRequestToken = $state(0);
	let fileEdit = $state(true);
	let inlineFileEdit = $state(true);
	let fileActionMenuOpenPath = $state<string | null>(null);
	let openFileZoom = $state(1);
	let openFilePanX = $state(0);
	let openFilePanY = $state(0);
	let openFileDragging = $state(false);
	let inlineFileZoom = $state(1);
	let inlineFilePanX = $state(0);
	let inlineFilePanY = $state(0);
	let inlineFileDragging = $state(false);
	let inlineFileCopied = $state(false);
	let inlineFileCopiedTimer: ReturnType<typeof setTimeout> | null = null;
	let openFileCopied = $state(false);
	let openFileCopiedTimer: ReturnType<typeof setTimeout> | null = null;
	let uploadPaneVisible = $state(false);
	let uploadPaneTargetDir = $state("");
	let pendingUploadFiles = $state<File[]>([]);
	let pendingUploadEntries = $state<{ file: File; relativePath: string }[]>([]);
	let pendingFileSavePaths = $state<Set<string>>(new Set());

	function isLocalUploadEntries(
		value: File[] | { file: File; relativePath: string }[],
	): value is { file: File; relativePath: string }[] {
		return value.length > 0 && "file" in value[0] && "relativePath" in value[0];
	}

	function isOwnPendingFileSave(
		path: string | undefined,
		source?: string,
		kind?: string,
	) {
		return Boolean(
			path &&
				source === "api-fs" &&
				kind === "modify" &&
				pendingFileSavePaths.has(path),
		);
	}

	function markFileSavePending(path: string) {
		pendingFileSavePaths = new Set(pendingFileSavePaths).add(path);
	}

	function clearFileSavePendingSoon(path: string) {
		setTimeout(() => {
			const next = new Set(pendingFileSavePaths);
			next.delete(path);
			pendingFileSavePaths = next;
		}, 3000);
	}

	function setActiveFileTree(nodes: SpaceFsNode[]) {
		fileTree = nodes;
		fileTreeBySource = {
			...fileTreeBySource,
			[options.getActiveFsSourceKey()]: nodes,
		};
	}

	function updateRootFsEntries(entries: SpaceFsEntry[]) {
		setActiveFileTree(makeFsNodes(entries, fileTree));
	}

	function switchSource(sourceKey: string) {
		if (fileTreeSourceKey === sourceKey) return;
		fileTreeBySource = { ...fileTreeBySource, [fileTreeSourceKey]: fileTree };
		fileTreeSourceKey = sourceKey;
		fileTree = fileTreeBySource[sourceKey] ?? [];
		directoryLoadTokenByPath = {};
		fileTreeError = null;
		fileTreeLoading = false;
		fileTreeRequestToken += 1;
		inlineFileRequestToken += 1;
		inlineFile = null;
		void loadFileTree(false);
	}

	function clearRouteFile() {
		openFile = null;
		openFileDraft = "";
		openFileError = null;
		openFileTooLarge = false;
		fileEdit = true;
	}

	function resetForSpace() {
		fileTree = [];
		fileTreeBySource = {};
		fileTreeSourceKey = "live";
		fileTreeLoading = false;
		fileTreeError = null;
		directoryLoadTokenByPath = {};
		fileTreeRequestToken += 1;
		inlineFileRequestToken += 1;
		openFile = null;
		openFileDraft = "";
		openFileError = null;
		openFileTooLarge = false;
		openFileSaving = false;
		inlineFile = null;
		uploadPaneVisible = false;
		pendingUploadFiles = [];
		pendingUploadEntries = [];
		pendingFileSavePaths = new Set();
	}

	function markOpenFileExternalChange() {
		openFileError =
			"File changed externally. Save carefully or reload before editing further.";
	}

	function markInlineFileExternalChange() {
		if (!inlineFile) return;
		inlineFile.error =
			"File changed externally. Save carefully or reload before editing further.";
	}

	async function patchFsDirectory(
		dirPath: string,
		updater: (entries: SpaceFsEntry[]) => SpaceFsEntry[],
	) {
		const nextEntries = await patchCachedSpaceFsDir(
			options.getSpaceId(),
			dirPath,
			updater,
		);
		if (dirPath === "") {
			updateRootFsEntries(nextEntries);
			return nextEntries;
		}
		setActiveFileTree(
			replaceNodeChildren(fileTree, dirPath, makeFsNodes(nextEntries)),
		);
		return nextEntries;
	}

	function listActiveFsDir(path: string) {
		const spaceId = options.getSpaceId();
		const source = options.getActiveFsSource();
		if (source.kind === "checkpoint") {
			return sdk
				.space(spaceId)
				.checkpoints(source.checkpointId)
				.files.list(path);
		}
		return sdk.space(spaceId).files.list(path);
	}

	function readActiveFsFile(path: string) {
		const spaceId = options.getSpaceId();
		const source = options.getActiveFsSource();
		if (source.kind === "checkpoint") {
			return sdk
				.space(spaceId)
				.checkpoints(source.checkpointId)
				.files.read(path);
		}
		return sdk.space(spaceId).files.read(path);
	}

	async function loadFileTree(force = false) {
		const source = options.getActiveFsSource();
		const sourceKey = options.getActiveFsSourceKey();
		const spaceId = options.getSpaceId();
		if (fileTreeLoading && !force) return;
		const requestToken = fileTreeRequestToken + 1;
		fileTreeRequestToken = requestToken;
		if (options.getSpaceHasMinimalAccess()) {
			setActiveFileTree([]);
			fileTreeLoading = false;
			fileTreeError = "Files are not available for this shared session.";
			return;
		}
		if (!force) {
			if (source.kind === "live") {
				const cached = await getCachedSpaceFsDir(spaceId, "");
				if (
					requestToken !== fileTreeRequestToken ||
					sourceKey !== options.getActiveFsSourceKey()
				)
					return;
				if (cached && cached.length > 0)
					setActiveFileTree(makeFsNodes(cached, fileTree));
			} else {
				const cached = fileTreeBySource[sourceKey];
				if (cached) setActiveFileTree(cached);
			}
		}
		const shouldShowLoading = fileTree.length === 0 || force;
		if (shouldShowLoading) fileTreeLoading = true;
		fileTreeError = null;
		try {
			const entries =
				source.kind === "live"
					? await fetchSpaceFsDirWithCache(
							spaceId,
							"",
							async () => {
								const tree = await sdk.space(spaceId).files.list("");
								return tree.entries;
							},
							{ force: true },
						)
					: (
							await sdk
								.space(spaceId)
								.checkpoints(source.checkpointId)
								.files.list("")
						).entries;
			if (
				requestToken !== fileTreeRequestToken ||
				sourceKey !== options.getActiveFsSourceKey()
			)
				return;
			setActiveFileTree(makeFsNodes(entries, fileTree));
		} catch (error) {
			if (
				requestToken !== fileTreeRequestToken ||
				sourceKey !== options.getActiveFsSourceKey()
			)
				return;
			fileTreeError =
				error instanceof Error ? error.message : "Failed to load files";
		} finally {
			if (
				requestToken === fileTreeRequestToken &&
				sourceKey === options.getActiveFsSourceKey()
			)
				fileTreeLoading = false;
		}
	}

	async function expandDirectory(node: SpaceFsNode) {
		if (node.type !== "dir") return;
		if (node.isOpen) {
			directoryLoadTokenByPath = {
				...directoryLoadTokenByPath,
				[node.path]: (directoryLoadTokenByPath[node.path] ?? 0) + 1,
			};
			setActiveFileTree(
				updateNodeState(fileTree, node.path, (item) => ({
					...item,
					isOpen: false,
					isLoading: false,
				})),
			);
			return;
		}
		const requestToken = (directoryLoadTokenByPath[node.path] ?? 0) + 1;
		directoryLoadTokenByPath = {
			...directoryLoadTokenByPath,
			[node.path]: requestToken,
		};
		const source = options.getActiveFsSource();
		const sourceKey = options.getActiveFsSourceKey();
		const hasExistingChildren = node.children.length > 0;
		const cached =
			source.kind === "live"
				? await getCachedSpaceFsDir(options.getSpaceId(), node.path)
				: null;
		if (directoryLoadTokenByPath[node.path] !== requestToken) return;
		if (cached) {
			setActiveFileTree(
				replaceNodeChildren(fileTree, node.path, makeFsNodes(cached)),
			);
		} else {
			setActiveFileTree(
				updateNodeState(fileTree, node.path, (item) => ({
					...item,
					isLoading: !hasExistingChildren,
					isOpen: true,
				})),
			);
		}
		try {
			const entries =
				source.kind === "live"
					? await fetchSpaceFsDirWithCache(
							options.getSpaceId(),
							node.path,
							async () => {
								const tree = await sdk
									.space(options.getSpaceId())
									.files.list(node.path);
								return tree.entries;
							},
							{ force: true },
						)
					: (
							await sdk
								.space(options.getSpaceId())
								.checkpoints(source.checkpointId)
								.files.list(node.path)
						).entries;
			if (
				directoryLoadTokenByPath[node.path] !== requestToken ||
				sourceKey !== options.getActiveFsSourceKey()
			)
				return;
			setActiveFileTree(
				replaceNodeChildren(fileTree, node.path, makeFsNodes(entries)),
			);
		} catch (error) {
			if (directoryLoadTokenByPath[node.path] !== requestToken) return;
			setActiveFileTree(
				updateNodeState(fileTree, node.path, (item) => ({
					...item,
					isLoading: false,
				})),
			);
			fileTreeError =
				error instanceof Error ? error.message : "Failed to load directory";
		}
	}

	function refreshFileTree() {
		return loadFileTree(true);
	}

	function openSpaceFile(path: string) {
		void goto(buildSpaceFileRoute(options.getSpaceId(), path), {
			replaceState: true,
			noScroll: true,
			keepFocus: true,
		});
	}

	function closeFile() {
		options.onCloseRouteFile();
	}

	async function openFileFromUrl(path: string) {
		const requestSpaceId = options.getSpaceId();
		const isCurrentRequest = () =>
			options.getSpaceId() === requestSpaceId &&
			options.getRouteFilePath() === path;
		options.onCloseInlinePort();
		openFileLoading = true;
		openFileError = null;
		openFileTooLarge = false;
		try {
			const file = await sdk.space(requestSpaceId).files.read(path);
			if (!isCurrentRequest()) return;
			if (!("content" in file)) {
				openFile = null;
				openFileDraft = "";
				openFileError = "File is being prepared. Please retry shortly.";
				return;
			}
			fileEdit = !hasRenderedFilePreview(file);
			openFile = file;
			openFileDraft = file.kind === "text" ? file.content : "";
		} catch (error) {
			if (!isCurrentRequest()) return;
			if (error instanceof HttpError && error.status === 413) {
				openFileTooLarge = true;
				openFile = null;
				openFileDraft = "";
				openFileError = null;
			} else {
				openFileError =
					error instanceof Error ? error.message : "Failed to open file";
			}
		} finally {
			if (isCurrentRequest()) openFileLoading = false;
		}
	}

	async function saveOpenFile() {
		if (!options.getCanEditFiles() || openFile?.kind !== "text") return;
		const savingPath = openFile.path;
		markFileSavePending(savingPath);
		openFileSaving = true;
		openFileError = null;
		try {
			await sdk.space(options.getSpaceId()).files.write({
				path: savingPath,
				content: openFileDraft,
				encoding: "utf-8",
			});
			openFile = {
				...openFile,
				content: openFileDraft,
				size: new Blob([openFileDraft]).size,
			};
			await patchFsDirectory(getParentDirPath(savingPath), (entries) =>
				entries.map((entry) =>
					entry.path === savingPath
						? {
								...entry,
								size: new Blob([openFileDraft]).size,
								mtimeMs: Date.now(),
							}
						: entry,
				),
			);
		} catch (error) {
			openFileError =
				error instanceof Error ? error.message : "Failed to save file";
		} finally {
			openFileSaving = false;
			clearFileSavePendingSoon(savingPath);
		}
	}

	async function downloadActiveFsFile(
		path: string,
		knownFile: SpaceFsFileResponse | null | undefined,
	) {
		const filename = path.split("/").pop() ?? "download";
		const source = options.getActiveFsSource();
		if (source.kind === "live") {
			await downloadSpaceFile(options.getSpaceId(), path, filename, knownFile);
			return;
		}
		if (knownFile && (await downloadFileResponse(knownFile, filename))) return;
		const file = await readActiveFsFile(path);
		if ("content" in file && (await downloadFileResponse(file, filename)))
			return;
		throw new Error("Checkpoint file download is not available for this file.");
	}

	async function downloadOpenFile() {
		const routeFilePath = options.getRouteFilePath();
		if (!routeFilePath) return;
		await downloadSpaceFile(
			options.getSpaceId(),
			routeFilePath,
			routeFilePath.split("/").pop() ?? "download",
			openFile,
		);
	}

	async function downloadInlineFile() {
		if (!inlineFile) return;
		try {
			await downloadActiveFsFile(inlineFile.path, inlineFile.response);
		} catch (error) {
			inlineFile.error =
				error instanceof Error ? error.message : "Failed to download file";
		}
	}

	async function openInlineFile(path: string) {
		const sourceKey = options.getActiveFsSourceKey();
		const requestToken = inlineFileRequestToken + 1;
		inlineFileRequestToken = requestToken;
		options.onClosePreviewFocusMode();
		options.onEnsurePreviewPanelFits();
		options.onCloseInlinePort();
		options.onCloseInlineCanvas();
		inlineFile = {
			response: null,
			draft: "",
			path,
			loading: true,
			saving: false,
			error: null,
			tooLarge: false,
		};
		try {
			const file = await readActiveFsFile(path);
			if (
				requestToken !== inlineFileRequestToken ||
				sourceKey !== options.getActiveFsSourceKey()
			)
				return;
			if (!("content" in file)) {
				inlineFile = {
					response: null,
					draft: "",
					path,
					loading: false,
					saving: false,
					error: "File is being prepared. Please retry shortly.",
					tooLarge: false,
				};
				return;
			}
			inlineFileEdit = !hasRenderedFilePreview(file);
			inlineFile = {
				response: file,
				draft: file.kind === "text" ? file.content : "",
				path,
				loading: false,
				saving: false,
				error: null,
				tooLarge: false,
			};
		} catch (error) {
			if (
				requestToken !== inlineFileRequestToken ||
				sourceKey !== options.getActiveFsSourceKey()
			)
				return;
			if (error instanceof HttpError && error.status === 413) {
				inlineFile = {
					response: null,
					draft: "",
					path,
					loading: false,
					saving: false,
					error: null,
					tooLarge: true,
				};
			} else {
				inlineFile = {
					response: null,
					draft: "",
					path,
					loading: false,
					saving: false,
					error: error instanceof Error ? error.message : "Failed to open file",
					tooLarge: false,
				};
			}
		}
	}

	function closeInlineFile() {
		inlineFileRequestToken += 1;
		inlineFile = null;
		options.onClosePreviewFocusMode();
	}

	async function saveInlineFile() {
		if (
			options.getActiveFsReadonly() ||
			!options.getCanEditFiles() ||
			inlineFile?.response?.kind !== "text"
		)
			return;
		const savingPath = inlineFile.path;
		const nextContent = inlineFile.draft;
		markFileSavePending(savingPath);
		inlineFile.saving = true;
		inlineFile.error = null;
		try {
			await sdk.space(options.getSpaceId()).files.write({
				path: savingPath,
				content: nextContent,
				encoding: "utf-8",
			});
			inlineFile = {
				...inlineFile,
				response: {
					...inlineFile.response,
					content: nextContent,
					size: new Blob([nextContent]).size,
				} as SpaceFsFileResponse,
				error: null,
			};
			await patchFsDirectory(getParentDirPath(savingPath), (entries) =>
				entries.map((entry) =>
					entry.path === savingPath
						? {
								...entry,
								size: new Blob([nextContent]).size,
								mtimeMs: Date.now(),
							}
						: entry,
				),
			);
		} catch (error) {
			inlineFile.error =
				error instanceof Error ? error.message : "Failed to save file";
		} finally {
			if (inlineFile) inlineFile.saving = false;
			clearFileSavePendingSoon(savingPath);
		}
	}

	async function copyFileContent() {
		if (openFile?.kind !== "text") return;
		await navigator.clipboard.writeText(openFileDraft);
		openFileCopied = true;
		if (openFileCopiedTimer) clearTimeout(openFileCopiedTimer);
		openFileCopiedTimer = setTimeout(() => {
			openFileCopied = false;
		}, 1500);
	}

	async function copyInlineFileContent() {
		if (inlineFile?.response?.kind !== "text") return;
		await navigator.clipboard.writeText(inlineFile.draft);
		inlineFileCopied = true;
		if (inlineFileCopiedTimer) clearTimeout(inlineFileCopiedTimer);
		inlineFileCopiedTimer = setTimeout(() => {
			inlineFileCopied = false;
		}, 1500);
	}

	function handleUploadFiles(
		files: File[] | { file: File; relativePath: string }[],
		targetDir: string,
	) {
		if (options.getActiveFsReadonly() || !options.getCanEditFiles()) return;
		uploadPaneTargetDir = targetDir;
		if (isLocalUploadEntries(files)) {
			pendingUploadEntries = files;
			pendingUploadFiles = [];
		} else {
			pendingUploadFiles = files;
			pendingUploadEntries = files.map((file) => ({
				file,
				relativePath: file.name,
			}));
		}
		uploadPaneVisible = true;
	}

	async function handleUploadComplete() {
		await refreshFileTree();
	}

	async function handleCreateFile(parentPath: string) {
		if (options.getActiveFsReadonly() || !options.getCanEditFiles()) return;
		const name = prompt("New file name");
		if (!name?.trim()) return;
		const path = parentPath ? `${parentPath}/${name.trim()}` : name.trim();
		try {
			await sdk
				.space(options.getSpaceId())
				.files.write({ path, content: "", encoding: "utf-8" });
			await patchFsDirectory(parentPath, (entries) => [
				...entries,
				buildFsEntry(path, "file"),
			]);
			if (isCovasFile(path)) await options.onOpenInlineCanvas(path);
			else await openInlineFile(path);
		} catch (error) {
			fileTreeError =
				error instanceof Error ? error.message : "Failed to create file";
		}
	}

	async function handleCreateCanvas(parentPath: string) {
		if (options.getActiveFsReadonly() || !options.getCanEditFiles()) return;
		const name = prompt("New canvas name", "Untitled.covas");
		if (!name?.trim()) return;
		const fileName = ensureCovasExtension(name);
		const path = parentPath ? `${parentPath}/${fileName}` : fileName;
		try {
			await sdk.space(options.getSpaceId()).canvas.create({
				path,
				title: fileName,
				nodes: createEmptyCovasDocument().items.map(canvasItemToNode),
			});
			await patchFsDirectory(parentPath, (entries) => [
				...entries,
				buildFsEntry(path, "file"),
			]);
			await options.onOpenInlineCanvas(path);
		} catch (error) {
			fileTreeError =
				error instanceof Error ? error.message : "Failed to create canvas";
		}
	}

	async function handleCreateDir(parentPath: string) {
		if (options.getActiveFsReadonly() || !options.getCanEditFiles()) return;
		const name = prompt("New folder name");
		if (!name?.trim()) return;
		const path = parentPath ? `${parentPath}/${name.trim()}` : name.trim();
		try {
			await sdk.space(options.getSpaceId()).files.createDir(path);
			await patchFsDirectory(parentPath, (entries) => [
				...entries,
				buildFsEntry(path, "dir"),
			]);
		} catch (error) {
			fileTreeError =
				error instanceof Error ? error.message : "Failed to create folder";
		}
	}

	async function handleRenameNode(node: SpaceFsNode) {
		if (options.getActiveFsReadonly() || !options.getCanEditFiles()) return;
		const nextName = prompt("Rename", node.name);
		if (!nextName?.trim() || nextName.trim() === node.name) return;
		const parent = getParentDirPath(node.path);
		const toPath = parent ? `${parent}/${nextName.trim()}` : nextName.trim();
		try {
			await sdk
				.space(options.getSpaceId())
				.files.move({ fromPath: node.path, toPath });
			if (parent === getParentDirPath(toPath)) {
				await patchFsDirectory(parent, (entries) =>
					entries.map((entry) =>
						entry.path === node.path
							? {
									...entry,
									name: nextName.trim(),
									path: toPath,
									mtimeMs: Date.now(),
								}
							: entry,
					),
				);
			} else {
				await patchFsDirectory(parent, (entries) =>
					entries.filter((entry) => entry.path !== node.path),
				);
				await patchFsDirectory(getParentDirPath(toPath), (entries) => [
					...entries,
					{
						...buildFsEntry(toPath, node.type),
						size: node.size,
						mimeType: node.mimeType,
						mtimeMs: Date.now(),
					},
				]);
			}
			if (node.type === "dir")
				await clearCachedSpaceFsSubtree(options.getSpaceId(), node.path);
			if (openFile?.path === node.path) closeFile();
			if (inlineFile?.path === node.path) await openInlineFile(toPath);
			options.onRenameInlineCanvas?.(node.path, toPath);
		} catch (error) {
			fileTreeError =
				error instanceof Error ? error.message : "Failed to rename";
		}
	}

	async function handleDownloadNode(node: SpaceFsNode) {
		if (node.type !== "file") return;
		try {
			await downloadActiveFsFile(node.path, null);
		} catch (error) {
			fileTreeError =
				error instanceof Error ? error.message : "Failed to download";
		}
	}

	async function handleDeleteNode(node: SpaceFsNode) {
		if (options.getActiveFsReadonly() || !options.getCanEditFiles()) return;
		if (!confirm(`Delete ${node.name}?`)) return;
		try {
			await sdk
				.space(options.getSpaceId())
				.files.delete(node.path, node.type === "dir");
			await patchFsDirectory(getParentDirPath(node.path), (entries) =>
				entries.filter((entry) => entry.path !== node.path),
			);
			if (node.type === "dir")
				await clearCachedSpaceFsSubtree(options.getSpaceId(), node.path);
			if (openFile?.path === node.path) closeFile();
			if (inlineFile?.path === node.path) closeInlineFile();
		} catch (error) {
			fileTreeError =
				error instanceof Error ? error.message : "Failed to delete";
		}
	}

	function findFsNode(
		path: string,
		nodes: SpaceFsNode[] = fileTree,
	): SpaceFsNode | null {
		for (const node of nodes) {
			if (node.path === path) return node;
			const child = findFsNode(path, node.children);
			if (child) return child;
		}
		return null;
	}

	function applyDirectoryEntries(dirPath: string, entries: SpaceFsEntry[]) {
		if (dirPath === "") {
			updateRootFsEntries(entries);
			return;
		}
		setActiveFileTree(
			replaceNodeChildren(fileTree, dirPath, makeFsNodes(entries)),
		);
	}

	function markDirectoryUnloaded(dirPath: string) {
		setActiveFileTree(
			updateNodeState(fileTree, dirPath, (item) => ({
				...item,
				isLoaded: false,
			})),
		);
	}

	function getFileActionNode(path: string): SpaceFsNode {
		const existingNode = findFsNode(path);
		if (existingNode) return existingNode;
		const response =
			openFile?.path === path
				? openFile
				: inlineFile?.response?.path === path
					? inlineFile.response
					: null;
		return {
			...buildFsEntry(path, "file"),
			size: response?.size ?? 0,
			mimeType: response?.mimeType ?? null,
			children: [],
			isOpen: false,
			isLoaded: false,
			isLoading: false,
		};
	}

	function closeReadyCopies() {
		if (inlineFileCopiedTimer) clearTimeout(inlineFileCopiedTimer);
		if (openFileCopiedTimer) clearTimeout(openFileCopiedTimer);
	}

	function dispose() {
		closeReadyCopies();
	}

	function renamePath(fromPath: string, toPath: string) {
		if (openFile?.path === fromPath) openFile = { ...openFile, path: toPath };
		if (inlineFile?.path === fromPath)
			inlineFile = { ...inlineFile, path: toPath };
	}

	return {
		get fileTree() {
			return fileTree;
		},
		get fileTreeLoading() {
			return fileTreeLoading;
		},
		get fileTreeError() {
			return fileTreeError;
		},
		get openFile() {
			return openFile;
		},
		get openFileDraft() {
			return openFileDraft;
		},
		set openFileDraft(value: string) {
			openFileDraft = value;
		},
		get openFileLoading() {
			return openFileLoading;
		},
		get openFileSaving() {
			return openFileSaving;
		},
		get openFileError() {
			return openFileError;
		},
		get openFileTooLarge() {
			return openFileTooLarge;
		},
		get openFileDownloadUrl() {
			return routeDownloadUrl(options.getSpaceId(), options.getRouteFilePath());
		},
		get openFileDownloadName() {
			return routeDownloadName(options.getRouteFilePath());
		},
		get openFileIsText() {
			return Boolean(openFile?.kind === "text");
		},
		get openFileHasRenderedPreview() {
			return Boolean(openFile && hasRenderedFilePreview(openFile));
		},
		get openFileExt() {
			return openFile?.kind === "text"
				? (openFile.name.split(".").pop()?.toLowerCase() ?? "plaintext")
				: "plaintext";
		},
		get openFileIsMarkdown() {
			return Boolean(
				openFile?.kind === "text" && isMarkdownPath(openFile.path),
			);
		},
		get openFileIsHtml() {
			return Boolean(openFile?.kind === "text" && isHtmlPath(openFile.path));
		},
		get openFileIsImage() {
			return Boolean(openFile?.mimeType?.startsWith("image/"));
		},
		get openFileIsVideo() {
			return Boolean(openFile?.mimeType?.startsWith("video/"));
		},
		get openFileDataUrl() {
			return openFile?.kind === "binary"
				? openFile.delivery === "url"
					? (openFile.url ?? null)
					: `data:${openFile.mimeType ?? "application/octet-stream"};base64,${openFile.content}`
				: null;
		},
		get fileDirty() {
			return Boolean(
				openFile &&
					openFile.kind === "text" &&
					openFileDraft !== openFile.content,
			);
		},
		get fileEdit() {
			return fileEdit;
		},
		set fileEdit(value: boolean) {
			fileEdit = value;
		},
		get fileActionMenuOpenPath() {
			return fileActionMenuOpenPath;
		},
		set fileActionMenuOpenPath(value: string | null) {
			fileActionMenuOpenPath = value;
		},
		get openFileZoom() {
			return openFileZoom;
		},
		set openFileZoom(value: number) {
			openFileZoom = value;
		},
		get openFilePanX() {
			return openFilePanX;
		},
		set openFilePanX(value: number) {
			openFilePanX = value;
		},
		get openFilePanY() {
			return openFilePanY;
		},
		set openFilePanY(value: number) {
			openFilePanY = value;
		},
		get openFileDragging() {
			return openFileDragging;
		},
		set openFileDragging(value: boolean) {
			openFileDragging = value;
		},
		get openFileCopied() {
			return openFileCopied;
		},
		get inlineFile() {
			return inlineFile;
		},
		get inlineFileDirty() {
			return Boolean(
				inlineFile &&
					inlineFile.response?.kind === "text" &&
					inlineFile.draft !== inlineFile.response.content,
			);
		},
		get inlineFileIsMarkdown() {
			return Boolean(
				inlineFile?.response?.kind === "text" &&
					isMarkdownPath(inlineFile.response.path),
			);
		},
		get inlineFileIsHtml() {
			return Boolean(
				inlineFile?.response?.kind === "text" &&
					isHtmlPath(inlineFile.response.path),
			);
		},
		get inlineFileHasRenderedPreview() {
			return Boolean(
				inlineFile &&
					inlineFile.response?.kind === "text" &&
					hasRenderedFilePreview(inlineFile.response),
			);
		},
		get inlineFileIsText() {
			return Boolean(inlineFile?.response?.kind === "text");
		},
		get inlineFileExt() {
			return inlineFile?.response?.kind === "text"
				? (inlineFile.response.name.split(".").pop()?.toLowerCase() ??
						"plaintext")
				: "plaintext";
		},
		get inlineFileIsImage() {
			return Boolean(inlineFile?.response?.mimeType?.startsWith("image/"));
		},
		get inlineFileIsVideo() {
			return Boolean(inlineFile?.response?.mimeType?.startsWith("video/"));
		},
		get inlineFileDataUrl() {
			return inlineFile?.response?.kind === "binary"
				? inlineFile.response.delivery === "url"
					? (inlineFile.response.url ?? null)
					: `data:${inlineFile.response.mimeType ?? "application/octet-stream"};base64,${inlineFile.response.content}`
				: null;
		},
		get inlineFileDownloadUrl() {
			if (!inlineFile) return "";
			if (options.getActiveFsSource().kind === "checkpoint") {
				return inlineFile.response?.delivery === "url"
					? (inlineFile.response.url ?? "")
					: "";
			}
			return buildSpaceFileDownloadUrl(options.getSpaceId(), inlineFile.path);
		},
		get inlineFileDownloadName() {
			return inlineFile ? (inlineFile.path.split("/").pop() ?? "download") : "";
		},
		get inlineFileEdit() {
			return inlineFileEdit;
		},
		set inlineFileEdit(value: boolean) {
			inlineFileEdit = value;
		},
		get inlineFileCopied() {
			return inlineFileCopied;
		},
		get inlineFileZoom() {
			return inlineFileZoom;
		},
		set inlineFileZoom(value: number) {
			inlineFileZoom = value;
		},
		get inlineFilePanX() {
			return inlineFilePanX;
		},
		set inlineFilePanX(value: number) {
			inlineFilePanX = value;
		},
		get inlineFilePanY() {
			return inlineFilePanY;
		},
		set inlineFilePanY(value: number) {
			inlineFilePanY = value;
		},
		get inlineFileDragging() {
			return inlineFileDragging;
		},
		set inlineFileDragging(value: boolean) {
			inlineFileDragging = value;
		},
		get uploadPaneVisible() {
			return uploadPaneVisible;
		},
		set uploadPaneVisible(value: boolean) {
			uploadPaneVisible = value;
		},
		get uploadPaneTargetDir() {
			return uploadPaneTargetDir;
		},
		get pendingUploadFiles() {
			return pendingUploadFiles;
		},
		get pendingUploadEntries() {
			return pendingUploadEntries;
		},
		get fileTreeSourceKey() {
			return fileTreeSourceKey;
		},
		set fileTreeSourceKey(value: string) {
			fileTreeSourceKey = value;
		},
		get directoryLoadTokenByPath() {
			return directoryLoadTokenByPath;
		},
		get openFileRequestToken() {
			return fileTreeRequestToken;
		},
		get inlineFileRequestToken() {
			return inlineFileRequestToken;
		},
		setActiveFileTree,
		updateRootFsEntries,
		switchSource,
		clearRouteFile,
		resetForSpace,
		markOpenFileExternalChange,
		markInlineFileExternalChange,
		loadFileTree,
		expandDirectory,
		refreshFileTree,
		openSpaceFile,
		openFileFromUrl,
		saveOpenFile,
		closeFile,
		openInlineFile,
		closeInlineFile,
		saveInlineFile,
		copyFileContent,
		copyInlineFileContent,
		downloadOpenFile,
		downloadInlineFile,
		downloadActiveFsFile,
		handleCreateFile,
		handleCreateCanvas,
		handleCreateDir,
		handleRenameNode,
		handleDownloadNode,
		handleDeleteNode,
		handleUploadFiles,
		handleUploadComplete,
		patchFsDirectory,
		readActiveFsFile,
		listActiveFsDir,
		markFileSavePending,
		clearFileSavePendingSoon,
		isOwnPendingFileSave,
		findFsNode,
		applyDirectoryEntries,
		markDirectoryUnloaded,
		getFileActionNode,
		renamePath,
		dispose,
	};
}

function routeDownloadUrl(spaceId: string, routeFilePath: string | null) {
	if (!routeFilePath) return "";
	return buildSpaceFileDownloadUrl(spaceId, routeFilePath);
}

function routeDownloadName(routeFilePath: string | null) {
	if (!routeFilePath) return "";
	return routeFilePath.split("/").pop() ?? "download";
}
