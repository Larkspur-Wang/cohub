<script lang="ts">
import "../app.css";
import { Pencil } from "lucide-svelte";
import { onMount, tick } from "svelte";
import { page } from "$app/state";
import MediaLightbox from "$lib/components/MediaLightbox.svelte";
import MobileSidebarDrawer from "$lib/components/MobileSidebarDrawer.svelte";
import Sidebar from "$lib/components/Sidebar.svelte";
import {
	type DrawerGestureDirection,
	type DrawerGesturePhase,
	getDrawerOffsetFromDrag,
	getRightDrawerOffsetFromDrag,
	MOBILE_DRAWER_WIDTH_PX,
	resolveDrawerGestureDirection,
	shouldKeepDrawerOpen,
	shouldKeepRightDrawerOpen,
	shouldOpenDrawer,
	shouldOpenRightDrawer,
	shouldStartDrawerGesture,
	shouldStartRightDrawerGesture,
} from "$lib/gestures/drawer-swipe";
import { DURATION_DRAWER_OUT } from "$lib/motion.svelte";
import { sdk } from "$lib/sdk";
import { authStore } from "$lib/stores/auth.svelte";
import {
	closeSessionContextMenu,
	sessionContextMenu,
} from "$lib/stores/session-context-menu.svelte";
import { patchCachedSessionList } from "$lib/stores/session-list-cache";
import {
	LEFT_SIDEBAR_MAX,
	LEFT_SIDEBAR_MIN,
	uiState,
} from "$lib/stores/ui.svelte";

const { children } = $props();

const currentPath = $derived(page.url.pathname);
const isLogin = $derived(currentPath === "/callback");
const isHome = $derived(currentPath === "/");
const isTrending = $derived(currentPath === "/trending");
const sidebarMode = $derived(
	currentPath.startsWith("/settings") ? "settings" : "space",
);

let gesturePhase = $state<DrawerGesturePhase>("idle");
let gestureDirection = $state<DrawerGestureDirection>(null);
let activeTouchId = $state<number | null>(null);
let activeGestureType = $state<"left" | "right" | null>(null);
let pointerStartX = $state(0);
let pointerStartY = $state(0);
let lastPointerX = $state(0);
let lastPointerTime = $state(0);
let dragOffsetPx = $state(0);
let velocityX = $state(0);
let isDragging = $state(false);
let leftSidebarResizeCleanup: (() => void) | null = null;

const isDrawerVisible = $derived(
	isDragging || gesturePhase === "settling" || uiState.mobileDrawerOpen,
);
const isRightDrawerVisible = $derived(
	uiState.rightIsDragging ||
		gesturePhase === "settling" ||
		uiState.mobileRightDrawerOpen,
);

function resetGestureState() {
	gesturePhase = "idle";
	gestureDirection = null;
	activeTouchId = null;
	activeGestureType = null;
	pointerStartX = 0;
	pointerStartY = 0;
	lastPointerX = 0;
	lastPointerTime = 0;
	dragOffsetPx = 0;
	uiState.rightDragOffsetPx = 0;
	uiState.rightIsDragging = false;
	velocityX = 0;
	isDragging = false;
}

function beginSettling(open: boolean) {
	gesturePhase = "settling";
	if (activeGestureType === "right") {
		uiState.mobileRightDrawerOpen = open;
	} else {
		uiState.mobileDrawerOpen = open;
	}
	isDragging = false;
	uiState.rightIsDragging = false;
	activeTouchId = null;
	activeGestureType = null;
	gestureDirection = null;
	velocityX = 0;
	lastPointerTime = 0;
	lastPointerX = 0;
	pointerStartX = 0;
	pointerStartY = 0;
}

function findTrackedTouch(touches: TouchList) {
	if (activeTouchId === null) return null;
	for (const touch of Array.from(touches)) {
		if (touch.identifier === activeTouchId) return touch;
	}
	return null;
}

function handleTouchStart(e: TouchEvent) {
	if (window.innerWidth >= 1024 || activeTouchId !== null) return;
	const touch = e.changedTouches[0];
	if (!touch) return;

	// Try right drawer first (right edge), then left drawer
	if (
		shouldStartRightDrawerGesture({
			isOpen: uiState.mobileRightDrawerOpen,
			target: e.target,
			viewportWidth: window.innerWidth,
			touchStartX: touch.clientX,
			otherDrawerOpen: uiState.mobileDrawerOpen,
		})
	) {
		activeTouchId = touch.identifier;
		activeGestureType = "right";
		gesturePhase = "tracking";
		gestureDirection = null;
		pointerStartX = touch.clientX;
		pointerStartY = touch.clientY;
		lastPointerX = touch.clientX;
		lastPointerTime = e.timeStamp;
		uiState.rightDragOffsetPx = uiState.mobileRightDrawerOpen
			? MOBILE_DRAWER_WIDTH_PX
			: 0;
		uiState.rightIsDragging = false;
		velocityX = 0;
		isDragging = false;
		return;
	}

	if (
		!shouldStartDrawerGesture({
			isOpen: uiState.mobileDrawerOpen,
			target: e.target,
			viewportWidth: window.innerWidth,
			touchStartX: touch.clientX,
			otherDrawerOpen: uiState.mobileRightDrawerOpen,
		})
	) {
		return;
	}

	activeTouchId = touch.identifier;
	activeGestureType = "left";
	gesturePhase = "tracking";
	gestureDirection = null;
	pointerStartX = touch.clientX;
	pointerStartY = touch.clientY;
	lastPointerX = touch.clientX;
	lastPointerTime = e.timeStamp;
	dragOffsetPx = uiState.mobileDrawerOpen ? MOBILE_DRAWER_WIDTH_PX : 0;
	velocityX = 0;
	isDragging = false;
}

function handleTouchMove(e: TouchEvent) {
	const touch = findTrackedTouch(e.touches);
	if (!touch) return;

	const dx = touch.clientX - pointerStartX;
	const dy = touch.clientY - pointerStartY;
	const absDx = Math.abs(dx);
	const absDy = Math.abs(dy);

	if (gestureDirection === null) {
		const resolvedDirection = resolveDrawerGestureDirection({ absDx, absDy });
		if (resolvedDirection === null) {
			return;
		}
		if (resolvedDirection === "vertical") {
			resetGestureState();
			return;
		}
		gestureDirection = resolvedDirection;
	}

	const deltaTime = Math.max(e.timeStamp - lastPointerTime, 1);
	velocityX = (touch.clientX - lastPointerX) / deltaTime;
	lastPointerX = touch.clientX;
	lastPointerTime = e.timeStamp;

	if (activeGestureType === "right") {
		const nextOffsetPx = getRightDrawerOffsetFromDrag({
			isOpen: uiState.mobileRightDrawerOpen,
			deltaX: dx,
		});

		if (!uiState.mobileRightDrawerOpen && nextOffsetPx <= 0) return;
		if (
			uiState.mobileRightDrawerOpen &&
			nextOffsetPx >= MOBILE_DRAWER_WIDTH_PX &&
			dx <= 0
		)
			return;

		isDragging = true;
		uiState.rightIsDragging = true;
		uiState.rightDragOffsetPx = nextOffsetPx;
		gesturePhase = uiState.mobileRightDrawerOpen
			? "dragging-close"
			: "dragging-open";
	} else {
		const nextOffsetPx = getDrawerOffsetFromDrag({
			isOpen: uiState.mobileDrawerOpen,
			deltaX: dx,
		});

		if (!uiState.mobileDrawerOpen && nextOffsetPx <= 0) return;
		if (
			uiState.mobileDrawerOpen &&
			nextOffsetPx >= MOBILE_DRAWER_WIDTH_PX &&
			dx >= 0
		)
			return;

		isDragging = true;
		dragOffsetPx = nextOffsetPx;
		gesturePhase = uiState.mobileDrawerOpen
			? "dragging-close"
			: "dragging-open";
	}

	if (e.cancelable) {
		e.preventDefault();
	}
}

function finalizeGesture() {
	if (!isDragging) {
		resetGestureState();
		return;
	}

	let shouldOpen: boolean;
	if (activeGestureType === "right") {
		shouldOpen = uiState.mobileRightDrawerOpen
			? shouldKeepRightDrawerOpen({
					offsetPx: uiState.rightDragOffsetPx,
					velocityX,
				})
			: shouldOpenRightDrawer({
					offsetPx: uiState.rightDragOffsetPx,
					velocityX,
				});
	} else {
		shouldOpen = uiState.mobileDrawerOpen
			? shouldKeepDrawerOpen({ offsetPx: dragOffsetPx, velocityX })
			: shouldOpenDrawer({ offsetPx: dragOffsetPx, velocityX });
	}

	beginSettling(shouldOpen);
}

function handleTouchEnd(e: TouchEvent) {
	const touch = findTrackedTouch(e.changedTouches);
	if (!touch) return;
	finalizeGesture();
}

function handleTouchCancel(e: TouchEvent) {
	const touch = findTrackedTouch(e.changedTouches);
	if (!touch) return;
	finalizeGesture();
}

function beginLeftSidebarResize(event: PointerEvent) {
	if (window.innerWidth < 1024) return;
	event.preventDefault();

	leftSidebarResizeCleanup?.();

	const startX = event.clientX;
	const startWidth = uiState.leftSidebarWidth;
	const minMainWidth = 640;

	const onPointerMove = (moveEvent: PointerEvent) => {
		const delta = moveEvent.clientX - startX;
		const viewportLimit = window.innerWidth - minMainWidth;
		const nextWidth = Math.min(
			LEFT_SIDEBAR_MAX,
			Math.max(LEFT_SIDEBAR_MIN, Math.min(startWidth + delta, viewportLimit)),
		);
		uiState.setLeftSidebarWidth(nextWidth);
	};

	const stop = () => {
		document.body.classList.remove("sidebar-resizing");
		window.removeEventListener("pointermove", onPointerMove);
		window.removeEventListener("pointerup", stop);
		window.removeEventListener("pointercancel", stop);
		if (leftSidebarResizeCleanup === stop) {
			leftSidebarResizeCleanup = null;
		}
	};

	leftSidebarResizeCleanup = stop;
	document.body.classList.add("sidebar-resizing");
	window.addEventListener("pointermove", onPointerMove);
	window.addEventListener("pointerup", stop);
	window.addEventListener("pointercancel", stop);
}

// Close drawer on Escape
$effect(() => {
	function handleKeydown(e: KeyboardEvent) {
		if (e.key === "Escape") {
			if (uiState.mobileDrawerOpen) uiState.mobileDrawerOpen = false;
			if (uiState.mobileRightDrawerOpen) uiState.mobileRightDrawerOpen = false;
		}
	}
	window.addEventListener("keydown", handleKeydown);
	return () => window.removeEventListener("keydown", handleKeydown);
});

$effect(() => {
	function onTouchStart(e: TouchEvent) {
		handleTouchStart(e);
	}
	function onTouchMove(e: TouchEvent) {
		handleTouchMove(e);
	}
	function onTouchEnd(e: TouchEvent) {
		handleTouchEnd(e);
	}
	function onTouchCancel(e: TouchEvent) {
		handleTouchCancel(e);
	}

	document.addEventListener("touchstart", onTouchStart, { passive: true });
	document.addEventListener("touchmove", onTouchMove, { passive: false });
	document.addEventListener("touchend", onTouchEnd, { passive: true });
	document.addEventListener("touchcancel", onTouchCancel, { passive: true });

	return () => {
		document.removeEventListener("touchstart", onTouchStart);
		document.removeEventListener("touchmove", onTouchMove);
		document.removeEventListener("touchend", onTouchEnd);
		document.removeEventListener("touchcancel", onTouchCancel);
	};
});

$effect(() => {
	if (gesturePhase !== "settling") return;

	const timer = window.setTimeout(() => {
		if (gesturePhase === "settling") {
			gesturePhase = "idle";
			if (!uiState.mobileRightDrawerOpen) uiState.rightDragOffsetPx = 0;
			if (!uiState.mobileDrawerOpen) dragOffsetPx = 0;
		}
	}, DURATION_DRAWER_OUT);

	return () => window.clearTimeout(timer);
});

// Lock body scroll when drawer is open
$effect(() => {
	if (
		uiState.mobileDrawerOpen ||
		uiState.mobileRightDrawerOpen ||
		isDragging ||
		uiState.rightIsDragging
	) {
		document.body.classList.add("drawer-open");
	} else {
		document.body.classList.remove("drawer-open");
	}
});

onMount(() => {
	uiState.loadLayoutPrefs();
	void authStore.ensureLoaded();

	// Register PWA Service Worker (conservative update: closes all tabs to activate)
	if ("serviceWorker" in navigator) {
		window.addEventListener("load", () => {
			void navigator.serviceWorker.register("/sw.js");
		});
	}

	return () => {
		leftSidebarResizeCleanup?.();
		document.body.classList.remove("sidebar-resizing");
	};
});

// ── Global session rename (triggered from sidebar context menu) ─────────

let globalRenamingSessionId = $state<string | null>(null);
let globalRenameValue = $state("");
let globalRenameSaving = $state(false);
let globalRenameInputEl: HTMLInputElement | null = $state(null);

function startGlobalRename() {
	const session = sessionContextMenu.session;
	if (!session) return;
	globalRenamingSessionId = session.id;
	globalRenameValue = session.title ?? "";
	closeSessionContextMenu();
	void tick().then(() => {
		globalRenameInputEl?.focus();
		globalRenameInputEl?.select();
	});
}

function cancelGlobalRename() {
	globalRenamingSessionId = null;
	globalRenameValue = "";
}

async function submitGlobalRename() {
	if (globalRenameSaving) return;
	const session = sessionContextMenu.session;
	if (!session) return;
	const trimmed = globalRenameValue.trim();
	if (!trimmed) {
		cancelGlobalRename();
		closeSessionContextMenu();
		return;
	}
	globalRenameSaving = true;
	try {
		const result = await sdk
			.space(session.spaceId)
			.session(session.id)
			.rename(trimmed);
		patchCachedSessionList(session.spaceId, (current) =>
			current.map((s) => (s.id === session.id ? { ...s, title: trimmed } : s)),
		);
	} catch {
		// Silently fail
	} finally {
		globalRenameSaving = false;
		cancelGlobalRename();
		closeSessionContextMenu();
	}
}
</script>

{#if isLogin || isHome || isTrending}
  <main class="min-h-screen bg-bg-primary text-text-primary">
    {@render children?.()}
  </main>
{:else}
  <div class="h-screen flex flex-col lg:flex-row bg-bg-primary text-text-primary font-sans text-[13px] leading-[1.6]">
    <!-- Desktop sidebar — hidden on mobile -->
    <div class="hidden lg:flex shrink-0 min-h-0 relative" style={`width: ${uiState.leftSidebarWidth}px`}>
      <div class="min-w-0 flex-1 border-r border-border-subtle">
        <Sidebar mode={sidebarMode} />
      </div>
      <button
        type="button"
        class="sidebar-resize-handle"
        aria-label="Resize navigation sidebar"
        title="Resize navigation sidebar"
        onpointerdown={beginLeftSidebarResize}
      ></button>
    </div>

    <!-- Main content area -->
    <main class="flex-1 flex flex-col min-w-0 overflow-hidden mobile-drawer-gesture-surface">

      <!-- Page content -->
      <div class="flex-1 flex flex-col min-w-0 overflow-hidden">
        {@render children?.()}
      </div>
    </main>
  </div>

  <!-- Mobile left drawer — outside flex container to avoid stacking context issues -->
  <MobileSidebarDrawer
    dragOffsetPx={dragOffsetPx}
    {isDragging}
    {isDrawerVisible}
    mode={sidebarMode}
  />

  <!-- Global media lightbox -->
  <MediaLightbox />

  <!-- Global mobile action sheet for session context menu -->
  {#if sessionContextMenu.session}
    <div
      class="fixed inset-0 z-[200] lg:hidden"
      onclick={closeSessionContextMenu}
    >
      <!-- Backdrop -->
      <div class="absolute inset-0 bg-black/40"></div>

      <!-- Action sheet -->
      <div
        class="absolute bottom-0 left-0 right-0 bg-bg-primary border-t border-border-subtle rounded-t-xl overflow-hidden z-50"
        onclick={(e) => e.stopPropagation()}
      >
        {#if globalRenamingSessionId === sessionContextMenu.session.id}
          <!-- Inline rename input -->
          <div class="p-4">
            <input
              bind:this={globalRenameInputEl}
              bind:value={globalRenameValue}
              type="text"
              class="w-full bg-bg-hover-strong text-[15px] text-text-primary outline-none rounded-lg px-3 py-2.5 leading-tight"
              placeholder="Session name"
              maxlength={80}
              disabled={globalRenameSaving}
              onkeydown={(e) => {
                if (e.key === "Enter" && !globalRenameSaving) {
                  e.preventDefault();
                  void submitGlobalRename();
                }
                if (e.key === "Escape" && !globalRenameSaving) {
                  e.preventDefault();
                  cancelGlobalRename();
                }
              }}
            />
            <div class="flex items-center gap-3 mt-3">
              <button
                type="button"
                class="flex-1 py-2.5 rounded-lg text-[15px] font-medium text-text-primary bg-bg-hover-strong active:bg-bg-hover-stronger transition-colors"
                disabled={globalRenameSaving}
                onclick={() => void submitGlobalRename()}
              >
                Save
              </button>
              <button
                type="button"
                class="flex-1 py-2.5 rounded-lg text-[15px] font-medium text-text-tertiary bg-bg-hover-strong active:bg-bg-hover-stronger transition-colors"
                disabled={globalRenameSaving}
                onclick={cancelGlobalRename}
              >
                Cancel
              </button>
            </div>
          </div>
        {:else}
          <div class="px-4 py-3 border-b border-border-subtle">
            <p class="text-[13px] text-text-secondary truncate">{sessionContextMenu.session.title || "New chat"}</p>
          </div>
          <button
            type="button"
            class="flex items-center gap-3 w-full px-4 py-4 text-[15px] text-text-primary active:bg-bg-hover transition-colors"
            onclick={startGlobalRename}
          >
            <Pencil class="w-5 h-5" />
            <span>Rename</span>
          </button>
          <div class="h-2"></div>
        {/if}
      </div>
    </div>
  {/if}
{/if}

<style>
  .sidebar-resize-handle {
    position: absolute;
    top: 0;
    right: -4px;
    bottom: 0;
    width: 8px;
    border: none;
    padding: 0;
    cursor: col-resize;
    background: transparent;
    touch-action: none;
    z-index: 10;
  }

  :global(body.sidebar-resizing) {
    cursor: col-resize;
    user-select: none;
  }
</style>
