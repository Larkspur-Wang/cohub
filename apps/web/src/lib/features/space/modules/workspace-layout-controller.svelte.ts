import { tick } from "svelte";
import { DESKTOP_SHELL_MIN_WIDTH_PX } from "$lib/layout/breakpoints";
import { uiState } from "$lib/stores/ui.svelte";

const MAIN_PANEL_MIN_WIDTH = 320;
const PREVIEW_PANEL_MIN_WIDTH = 280;

export type WorkspacePresentation = "default" | "focus" | "immersive";
export type MobileSurface = "main" | "files" | "preview";

type LayoutSnapshot = {
	leftSidebarCollapsed: boolean;
	rightSidebarCollapsed: boolean;
	previewWidth: number;
	treeVisible: boolean;
};

export function createWorkspaceLayoutController(options: {
	getIsCompact: () => boolean;
	getWorkspaceBodyEl: () => HTMLDivElement | null;
	getFilesAvailable: () => boolean;
	getHasPreview: () => boolean;
}) {
	let previewWidth = $state(480);
	let presentation = $state<WorkspacePresentation>("default");
	let mobileSurface = $state<MobileSurface>("main");
	let immersiveMainVisible = $state(true);
	/** Hide the whole Files column (preview stage + tree) without destroying tabs. */
	let filesColumnHidden = $state(false);
	let snapshot: LayoutSnapshot | null = $state(null);
	let resizeCleanup: (() => void) | null = null;

	const treeVisible = $derived(
		options.getFilesAvailable() && !uiState.rightSidebarCollapsed,
	);

	function getTreeReservedWidth() {
		if (!treeVisible) return 0;
		return uiState.rightSidebarWidth;
	}

	function getMaxPreviewWidth() {
		if (typeof window === "undefined") return previewWidth;
		const layoutWidth =
			options.getWorkspaceBodyEl()?.clientWidth ?? window.innerWidth;
		return Math.max(
			PREVIEW_PANEL_MIN_WIDTH,
			layoutWidth - MAIN_PANEL_MIN_WIDTH - getTreeReservedWidth(),
		);
	}

	function setPreviewWidth(
		nextWidth: number,
		options: { persistSnapshot?: boolean } = {},
	) {
		previewWidth = Math.min(
			Math.max(PREVIEW_PANEL_MIN_WIDTH, nextWidth),
			getMaxPreviewWidth(),
		);
		// Only user-driven resizes should rewrite the restore snapshot.
		if (options.persistSnapshot && snapshot) {
			snapshot = { ...snapshot, previewWidth };
		}
	}

	function ensurePreviewFits() {
		setPreviewWidth(previewWidth);
	}

	function captureSnapshot() {
		if (snapshot) return;
		snapshot = {
			leftSidebarCollapsed: uiState.leftSidebarCollapsed,
			rightSidebarCollapsed: uiState.rightSidebarCollapsed,
			previewWidth,
			treeVisible: !uiState.rightSidebarCollapsed,
		};
	}

	function restoreSnapshot() {
		const current = snapshot;
		snapshot = null;
		if (!current) return;
		uiState.setLeftSidebarCollapsed(current.leftSidebarCollapsed);
		uiState.setRightSidebarCollapsed(current.rightSidebarCollapsed);
		previewWidth = current.previewWidth;
		ensurePreviewFits();
	}

	function exitPresentation() {
		if (presentation === "default" && !snapshot) {
			immersiveMainVisible = true;
			return;
		}
		presentation = "default";
		immersiveMainVisible = true;
		restoreSnapshot();
	}

	async function enterFocus() {
		if (options.getIsCompact()) return;
		if (presentation === "focus") {
			exitPresentation();
			return;
		}
		captureSnapshot();
		presentation = "focus";
		immersiveMainVisible = true;
		filesColumnHidden = false;
		uiState.setLeftSidebarCollapsed(true);
		uiState.setRightSidebarCollapsed(true);
		await tick();
		setPreviewWidth(getMaxPreviewWidth());
	}

	async function enterImmersive() {
		if (options.getIsCompact()) return;
		if (presentation === "immersive") {
			exitPresentation();
			return;
		}
		captureSnapshot();
		presentation = "immersive";
		immersiveMainVisible = true;
		filesColumnHidden = false;
		uiState.setLeftSidebarCollapsed(true);
		uiState.setRightSidebarCollapsed(true);
		await tick();
	}

	async function toggleFocus() {
		await enterFocus();
	}

	async function toggleImmersive() {
		await enterImmersive();
	}

	function setMobileSurface(next: MobileSurface) {
		mobileSurface = next;
		if (next === "files" && options.getFilesAvailable()) {
			uiState.mobileRightDrawerOpen = true;
		} else if (next !== "files") {
			uiState.mobileRightDrawerOpen = false;
		}
	}

	function showFilesMobile() {
		if (!options.getFilesAvailable()) return;
		setMobileSurface("files");
	}

	function showPreviewMobile() {
		setMobileSurface("preview");
	}

	function showMainMobile() {
		setMobileSurface("main");
	}

	function handleCompactChange(isCompact: boolean) {
		if (isCompact) {
			if (presentation !== "default") exitPresentation();
			if (options.getHasPreview()) mobileSurface = "preview";
			else if (uiState.mobileRightDrawerOpen) mobileSurface = "files";
			else mobileSurface = "main";
			return;
		}
		if (mobileSurface === "files") {
			uiState.mobileRightDrawerOpen = false;
		}
		mobileSurface = "main";
	}

	function handleWindowResize() {
		if (presentation === "focus") {
			setPreviewWidth(getMaxPreviewWidth());
			return;
		}
		if (presentation === "immersive") return;
		if (options.getHasPreview()) ensurePreviewFits();
	}

	function beginPreviewResize(event: PointerEvent) {
		event.preventDefault();
		if (options.getIsCompact()) return;
		// Keep snapshot; only update live + snapshot widths.
		const target = event.currentTarget as HTMLElement | null;
		target?.setPointerCapture?.(event.pointerId);
		resizeCleanup?.();
		const startX = event.clientX;
		const startWidth = previewWidth;
		const onPointerMove = (moveEvent: PointerEvent) => {
			const delta = startX - moveEvent.clientX;
			setPreviewWidth(startWidth + delta, { persistSnapshot: true });
		};
		const stop = () => {
			document.body.classList.remove("sidebar-resizing");
			window.removeEventListener("pointermove", onPointerMove);
			window.removeEventListener("pointerup", stop);
			window.removeEventListener("pointercancel", stop);
			if (resizeCleanup === stop) resizeCleanup = null;
		};
		resizeCleanup = stop;
		document.body.classList.add("sidebar-resizing");
		window.addEventListener("pointermove", onPointerMove);
		window.addEventListener("pointerup", stop);
		window.addEventListener("pointercancel", stop);
	}

	/**
	 * Main-header control: show/hide the entire Files column
	 * (preview stage + file tree). Does not discard open tabs.
	 */
	function toggleFilesColumn() {
		if (window.innerWidth < DESKTOP_SHELL_MIN_WIDTH_PX) {
			// Mobile: drawer for tree; preview is full-screen overlay.
			if (!options.getFilesAvailable()) return;
			const nextOpen = !uiState.mobileRightDrawerOpen;
			uiState.mobileRightDrawerOpen = nextOpen;
			mobileSurface = nextOpen
				? "files"
				: options.getHasPreview()
					? "preview"
					: "main";
			return;
		}
		if (!options.getFilesAvailable()) return;
		filesColumnHidden = !filesColumnHidden;
		if (filesColumnHidden) {
			// Also collapse tree preference so restoring shows a clean default.
			// Keep tree collapsed state as-is; only hide column.
			return;
		}
		// Revealing column: ensure tree fits with preview if present.
		if (options.getHasPreview() && presentation === "default") {
			void tick().then(() => ensurePreviewFits());
		}
	}

	/** Files-column internal: collapse/expand file tree only. */
	async function toggleTree() {
		if (window.innerWidth < DESKTOP_SHELL_MIN_WIDTH_PX) {
			if (!options.getFilesAvailable()) return;
			const nextOpen = !uiState.mobileRightDrawerOpen;
			uiState.mobileRightDrawerOpen = nextOpen;
			mobileSurface = nextOpen
				? "files"
				: options.getHasPreview()
					? "preview"
					: "main";
			return;
		}
		if (!options.getFilesAvailable()) return;
		const nextCollapsed = !uiState.rightSidebarCollapsed;
		const treeWidth = uiState.rightSidebarWidth;
		uiState.setRightSidebarCollapsed(nextCollapsed);
		if (snapshot) {
			snapshot = {
				...snapshot,
				rightSidebarCollapsed: nextCollapsed,
				treeVisible: !nextCollapsed,
			};
		}
		if (!options.getHasPreview()) return;
		if (presentation === "immersive") return;
		if (presentation === "focus") {
			await tick();
			setPreviewWidth(getMaxPreviewWidth());
			return;
		}
		await tick();
		setPreviewWidth(previewWidth + (nextCollapsed ? treeWidth : -treeWidth));
	}

	function setImmersiveMainVisible(visible: boolean) {
		immersiveMainVisible = visible;
	}

	function dispose() {
		resizeCleanup?.();
		resizeCleanup = null;
	}

	return {
		get previewWidth() {
			return previewWidth;
		},
		get presentation() {
			return presentation;
		},
		get mobileSurface() {
			return mobileSurface;
		},
		get immersiveMainVisible() {
			return immersiveMainVisible;
		},
		get focusMode() {
			return presentation === "focus";
		},
		get immersiveMode() {
			return presentation === "immersive";
		},
		get treeVisible() {
			return treeVisible;
		},
		get filesColumnHidden() {
			return filesColumnHidden;
		},
		setPreviewWidth,
		ensurePreviewFits,
		toggleFocus,
		toggleImmersive,
		exitPresentation,
		handleWindowResize,
		handleCompactChange,
		beginPreviewResize,
		toggleTree,
		toggleFilesColumn,
		setFilesColumnHidden: (hidden: boolean) => {
			filesColumnHidden = hidden;
		},
		setMobileSurface,
		showFilesMobile,
		showPreviewMobile,
		showMainMobile,
		setImmersiveMainVisible,
		dispose,
	};
}
