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

	function clampPreviewWidth(nextWidth: number) {
		return Math.min(
			Math.max(PREVIEW_PANEL_MIN_WIDTH, nextWidth),
			getMaxPreviewWidth(),
		);
	}

	function getPreviewPaneEls(): HTMLElement[] {
		const body = options.getWorkspaceBodyEl();
		if (!body) return [];
		return Array.from(
			body.querySelectorAll<HTMLElement>(".workspace-preview-pane"),
		);
	}

	/** Live paint without touching Svelte state (avoids iframe remounts). */
	function paintPreviewWidth(nextWidth: number) {
		const px = `${nextWidth}px`;
		for (const pane of getPreviewPaneEls()) {
			// Prefer the same CSS variable the pane already uses so layout stays
			// consistent with focus/immersive modes.
			pane.style.setProperty("--workspace-preview-width", px);
		}
	}

	function setPreviewWidth(
		nextWidth: number,
		setOptions: { persistSnapshot?: boolean } = {},
	) {
		const clamped = clampPreviewWidth(nextWidth);
		if (previewWidth === clamped) {
			// Drag may have painted a temporary width; snap CSS back to state.
			paintPreviewWidth(clamped);
			if (setOptions.persistSnapshot && snapshot) {
				snapshot = { ...snapshot, previewWidth: clamped };
			}
			return;
		}
		// Paint first so the next Svelte style binding update lands on the same
		// value without a one-frame flash back to the previous width.
		paintPreviewWidth(clamped);
		previewWidth = clamped;
		// Only user-driven resizes should rewrite the restore snapshot.
		if (setOptions.persistSnapshot && snapshot) {
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
		// Keep snapshot; paint live width on the pane element during drag so
		// preview iframes are not torn down by Svelte prop thrashing.
		const target = event.currentTarget as HTMLElement | null;
		target?.setPointerCapture?.(event.pointerId);
		resizeCleanup?.();
		const startX = event.clientX;
		const startWidth = previewWidth;
		let liveWidth = startWidth;
		const onPointerMove = (moveEvent: PointerEvent) => {
			const delta = startX - moveEvent.clientX;
			liveWidth = clampPreviewWidth(startWidth + delta);
			paintPreviewWidth(liveWidth);
		};
		const stop = () => {
			document.body.classList.remove("sidebar-resizing");
			window.removeEventListener("pointermove", onPointerMove);
			window.removeEventListener("pointerup", stop);
			window.removeEventListener("pointercancel", stop);
			if (resizeCleanup === stop) resizeCleanup = null;
			// Commit once on release so dependent layout state stays in sync.
			setPreviewWidth(liveWidth, { persistSnapshot: true });
		};
		resizeCleanup = stop;
		document.body.classList.add("sidebar-resizing");
		window.addEventListener("pointermove", onPointerMove);
		window.addEventListener("pointerup", stop);
		window.addEventListener("pointercancel", stop);
	}

	function isCompactViewport() {
		// Prefer the page's reactive compact signal so header/toggle stay in
		// lockstep with layout; fall back to width when called outside the page.
		if (typeof options.getIsCompact === "function")
			return options.getIsCompact();
		if (typeof window === "undefined") return false;
		return window.innerWidth < DESKTOP_SHELL_MIN_WIDTH_PX;
	}

	/**
	 * Whether the Files chrome is effectively visible to the user.
	 * A collapsed tree with no preview paints as empty (0 width) even when
	 * `filesColumnHidden` is still false — treat that as hidden for header UI.
	 */
	function isFilesChromeEffectivelyHidden() {
		if (isCompactViewport()) return !uiState.mobileRightDrawerOpen;
		if (filesColumnHidden) return true;
		// Empty rail: column mounted, tree collapsed, nothing in preview stage.
		return uiState.rightSidebarCollapsed && !options.getHasPreview();
	}

	/**
	 * Main-header control: show/hide the entire Files column
	 * (preview stage + file tree). Does not discard open tabs.
	 *
	 * Intentionally does not gate on `getFilesAvailable()` — the header button
	 * is only rendered when files are available, and blocking on that signal
	 * caused first-click no-ops while space was still bootstrapping.
	 */
	function toggleFilesColumn() {
		if (isCompactViewport()) {
			// Mobile: drawer for tree; preview is full-screen overlay.
			const nextOpen = !uiState.mobileRightDrawerOpen;
			uiState.mobileRightDrawerOpen = nextOpen;
			mobileSurface = nextOpen
				? "files"
				: options.getHasPreview()
					? "preview"
					: "main";
			return;
		}
		filesColumnHidden = !filesColumnHidden;
		if (filesColumnHidden) {
			// Keep tree collapsed state as-is; only hide column.
			return;
		}
		// Revealing column: ensure tree fits with preview if present.
		if (options.getHasPreview() && presentation === "default") {
			void tick().then(() => ensurePreviewFits());
		}
	}

	/**
	 * Main-header control with consistent show/hide semantics.
	 * If chrome is already effectively hidden (empty rail / drawer closed),
	 * the first click always reveals something visible (column + tree).
	 */
	async function toggleFilesChrome() {
		if (isCompactViewport()) {
			toggleFilesColumn();
			return;
		}
		if (isFilesChromeEffectivelyHidden()) {
			if (filesColumnHidden) filesColumnHidden = false;
			// Empty rail or fully hidden: always open the tree so the click paints.
			if (uiState.rightSidebarCollapsed) {
				await toggleTree();
			} else if (options.getHasPreview() && presentation === "default") {
				void tick().then(() => ensurePreviewFits());
			}
			return;
		}
		toggleFilesColumn();
	}

	/** Files-column internal: collapse/expand file tree only. */
	async function toggleTree() {
		if (isCompactViewport()) {
			const nextOpen = !uiState.mobileRightDrawerOpen;
			uiState.mobileRightDrawerOpen = nextOpen;
			mobileSurface = nextOpen
				? "files"
				: options.getHasPreview()
					? "preview"
					: "main";
			return;
		}
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
		// Collapsing the tree with no preview leaves a 0-width empty rail —
		// fold the whole Files column so header state stays consistent.
		if (nextCollapsed && !options.getHasPreview()) {
			filesColumnHidden = true;
			return;
		}
		// Expanding tree while column was folded: reveal it.
		if (!nextCollapsed && filesColumnHidden) {
			filesColumnHidden = false;
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
		get filesChromeEffectivelyHidden() {
			return isFilesChromeEffectivelyHidden();
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
		toggleFilesChrome,
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
