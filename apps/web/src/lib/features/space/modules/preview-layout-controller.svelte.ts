import { tick } from "svelte";
import { DESKTOP_SHELL_MIN_WIDTH_PX } from "$lib/layout/breakpoints";
import { uiState } from "$lib/stores/ui.svelte";

const CHAT_PANEL_MIN_WIDTH = 320;
const PREVIEW_PANEL_MIN_WIDTH = 280;

export function createPreviewLayoutController(options: {
	getIsMobile: () => boolean;
	getWorkspaceBodyEl: () => HTMLDivElement | null;
	getSpaceHasMinimalAccess: () => boolean;
	getActivePreviewKind: () => string | null;
}) {
	let width = $state(480);
	let resizeCleanup: (() => void) | null = null;
	let focusMode = $state(false);
	let immersiveMode = $state(false);
	let layoutSnapshot: {
		leftSidebarCollapsed: boolean;
		rightSidebarCollapsed: boolean;
		width: number;
	} | null = null;

	function getRightSidebarReservedWidth() {
		if (uiState.rightSidebarCollapsed || options.getSpaceHasMinimalAccess())
			return 0;
		return uiState.rightSidebarWidth;
	}

	function getMaxWidth() {
		if (typeof window === "undefined") return width;
		const layoutWidth =
			options.getWorkspaceBodyEl()?.clientWidth ?? window.innerWidth;
		return Math.max(
			PREVIEW_PANEL_MIN_WIDTH,
			layoutWidth - CHAT_PANEL_MIN_WIDTH - getRightSidebarReservedWidth(),
		);
	}

	function setWidth(nextWidth: number) {
		width = Math.min(
			Math.max(PREVIEW_PANEL_MIN_WIDTH, nextWidth),
			getMaxWidth(),
		);
	}

	function ensureFits() {
		setWidth(width);
	}

	function restoreLayoutSnapshot() {
		const snapshot = layoutSnapshot;
		layoutSnapshot = null;
		if (!snapshot) return;
		uiState.setLeftSidebarCollapsed(snapshot.leftSidebarCollapsed);
		uiState.setRightSidebarCollapsed(snapshot.rightSidebarCollapsed);
		width = snapshot.width;
		ensureFits();
	}

	function captureLayoutSnapshot() {
		if (layoutSnapshot) return;
		layoutSnapshot = {
			leftSidebarCollapsed: uiState.leftSidebarCollapsed,
			rightSidebarCollapsed: uiState.rightSidebarCollapsed,
			width,
		};
	}

	async function toggleFocusMode() {
		if (options.getIsMobile()) return;
		if (focusMode) {
			focusMode = false;
			restoreLayoutSnapshot();
			return;
		}
		captureLayoutSnapshot();
		immersiveMode = false;
		focusMode = true;
		uiState.setLeftSidebarCollapsed(true);
		uiState.setRightSidebarCollapsed(true);
		await tick();
		setWidth(getMaxWidth());
	}

	async function toggleImmersiveMode() {
		if (options.getIsMobile()) return;
		if (immersiveMode) {
			immersiveMode = false;
			restoreLayoutSnapshot();
			return;
		}
		captureLayoutSnapshot();
		focusMode = false;
		immersiveMode = true;
		uiState.setLeftSidebarCollapsed(true);
		await tick();
	}

	function closeFocusMode() {
		if (!focusMode && !immersiveMode && !layoutSnapshot) return;
		focusMode = false;
		immersiveMode = false;
		restoreLayoutSnapshot();
	}

	function cancelFocusModeWithoutRestore() {
		focusMode = false;
		immersiveMode = false;
		layoutSnapshot = null;
	}

	function handleWindowResize() {
		if (focusMode) {
			setWidth(getMaxWidth());
			return;
		}
		if (immersiveMode) return;
		if (options.getActivePreviewKind()) ensureFits();
	}

	function beginPanelResize(event: PointerEvent) {
		event.preventDefault();
		if (options.getIsMobile()) return;
		cancelFocusModeWithoutRestore();
		const target = event.currentTarget as HTMLElement | null;
		target?.setPointerCapture?.(event.pointerId);
		resizeCleanup?.();
		const startX = event.clientX;
		const startWidth = width;
		const onPointerMove = (moveEvent: PointerEvent) => {
			const delta = startX - moveEvent.clientX;
			setWidth(startWidth + delta);
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

	async function toggleRightSidebar() {
		if (window.innerWidth < DESKTOP_SHELL_MIN_WIDTH_PX) {
			uiState.mobileRightDrawerOpen = !uiState.mobileRightDrawerOpen;
			return;
		}
		const nextCollapsed = !uiState.rightSidebarCollapsed;
		const rightWidth = uiState.rightSidebarWidth;
		uiState.setRightSidebarCollapsed(nextCollapsed);
		if (!options.getActivePreviewKind()) return;
		if (immersiveMode) {
			if (layoutSnapshot) layoutSnapshot.rightSidebarCollapsed = nextCollapsed;
			return;
		}
		closeFocusMode();
		await tick();
		setWidth(width + (nextCollapsed ? rightWidth : -rightWidth));
	}

	function dispose() {
		resizeCleanup?.();
		resizeCleanup = null;
	}

	return {
		get width() {
			return width;
		},
		get focusMode() {
			return focusMode;
		},
		get immersiveMode() {
			return immersiveMode;
		},
		setWidth,
		ensureFits,
		toggleFocusMode,
		toggleImmersiveMode,
		closeFocusMode,
		handleWindowResize,
		beginPanelResize,
		toggleRightSidebar,
		dispose,
	};
}
