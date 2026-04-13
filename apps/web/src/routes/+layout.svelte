<script lang="ts">
import "../app.css";
import { page } from "$app/state";
import Sidebar from "$lib/components/Sidebar.svelte";
import MobileSidebarDrawer from "$lib/components/MobileSidebarDrawer.svelte";
import {
  MOBILE_DRAWER_WIDTH_PX,
  getDrawerOffsetFromDrag,
  resolveDrawerGestureDirection,
  shouldKeepDrawerOpen,
  shouldOpenDrawer,
  shouldStartDrawerGesture,
  type DrawerGestureDirection,
  type DrawerGesturePhase,
} from "$lib/gestures/drawer-swipe";
import { getResolvedTheme } from "$lib/theme";
import { onMount } from "svelte";
import { uiState } from "$lib/stores/ui.svelte";
import MediaLightbox from "$lib/components/MediaLightbox.svelte";
import { authStore } from "$lib/stores/auth.svelte";
import { hydrateRuntimeStoreFromSidebarCache } from "$lib/stores/cache-hydration";

const { children } = $props();

const currentPath = $derived(page.url.pathname);
const isLogin = $derived(currentPath === "/callback");
const resolvedTheme = $derived(getResolvedTheme());

let gesturePhase = $state<DrawerGesturePhase>("idle");
let gestureDirection = $state<DrawerGestureDirection>(null);
let activePointerId = $state<number | null>(null);
let pointerStartX = $state(0);
let pointerStartY = $state(0);
let lastPointerX = $state(0);
let lastPointerTime = $state(0);
let dragOffsetPx = $state(0);
let velocityX = $state(0);
let isDragging = $state(false);

const isDrawerVisible = $derived(
  isDragging || gesturePhase === "settling" || uiState.mobileDrawerOpen,
);

function resetGestureState() {
  gesturePhase = "idle";
  gestureDirection = null;
  activePointerId = null;
  pointerStartX = 0;
  pointerStartY = 0;
  lastPointerX = 0;
  lastPointerTime = 0;
  dragOffsetPx = 0;
  velocityX = 0;
  isDragging = false;
}

function beginSettling(open: boolean) {
  gesturePhase = "settling";
  uiState.mobileDrawerOpen = open;
  isDragging = false;
  activePointerId = null;
  gestureDirection = null;
  velocityX = 0;
  lastPointerTime = 0;
  lastPointerX = 0;
  pointerStartX = 0;
  pointerStartY = 0;
}

function handlePointerDown(e: PointerEvent) {
  if (e.pointerType !== "touch" && e.pointerType !== "pen") return;
  if (window.innerWidth >= 1024 || activePointerId !== null) return;
  if (
    !shouldStartDrawerGesture({
      isOpen: uiState.mobileDrawerOpen,
      startX: e.clientX,
      viewportWidth: window.innerWidth,
    })
  ) {
    return;
  }

  activePointerId = e.pointerId;
  gesturePhase = "tracking";
  gestureDirection = null;
  pointerStartX = e.clientX;
  pointerStartY = e.clientY;
  lastPointerX = e.clientX;
  lastPointerTime = e.timeStamp;
  dragOffsetPx = uiState.mobileDrawerOpen ? MOBILE_DRAWER_WIDTH_PX : 0;
  velocityX = 0;
  isDragging = false;
}

function handlePointerMove(e: PointerEvent) {
  if (e.pointerId !== activePointerId) return;

  const dx = e.clientX - pointerStartX;
  const dy = e.clientY - pointerStartY;
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
  velocityX = (e.clientX - lastPointerX) / deltaTime;
  lastPointerX = e.clientX;
  lastPointerTime = e.timeStamp;

  const nextOffsetPx = getDrawerOffsetFromDrag({
    isOpen: uiState.mobileDrawerOpen,
    deltaX: dx,
  });

  if (!uiState.mobileDrawerOpen && nextOffsetPx <= 0) {
    return;
  }
  if (uiState.mobileDrawerOpen && nextOffsetPx >= MOBILE_DRAWER_WIDTH_PX && dx >= 0) {
    return;
  }

  isDragging = true;
  dragOffsetPx = nextOffsetPx;
  gesturePhase = uiState.mobileDrawerOpen ? "dragging-close" : "dragging-open";

  if (e.cancelable) {
    e.preventDefault();
  }
}

function finalizeGesture() {
  if (!isDragging) {
    resetGestureState();
    return;
  }

  const shouldOpen = uiState.mobileDrawerOpen
    ? shouldKeepDrawerOpen({ offsetPx: dragOffsetPx, velocityX })
    : shouldOpenDrawer({ offsetPx: dragOffsetPx, velocityX });

  beginSettling(shouldOpen);
}

function handlePointerUp(e: PointerEvent) {
  if (e.pointerId !== activePointerId) return;
  finalizeGesture();
}

function handlePointerCancel(e: PointerEvent) {
  if (e.pointerId !== activePointerId) return;
  finalizeGesture();
}

// Close drawer on Escape
$effect(() => {
  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Escape" && uiState.mobileDrawerOpen) {
      uiState.mobileDrawerOpen = false;
    }
  }
  window.addEventListener("keydown", handleKeydown);
  return () => window.removeEventListener("keydown", handleKeydown);
});

$effect(() => {
  function onPointerDown(e: PointerEvent) {
    handlePointerDown(e);
  }
  function onPointerMove(e: PointerEvent) {
    handlePointerMove(e);
  }
  function onPointerUp(e: PointerEvent) {
    handlePointerUp(e);
  }
  function onPointerCancel(e: PointerEvent) {
    handlePointerCancel(e);
  }

  document.addEventListener("pointerdown", onPointerDown, { passive: true });
  document.addEventListener("pointermove", onPointerMove, { passive: false });
  document.addEventListener("pointerup", onPointerUp, { passive: true });
  document.addEventListener("pointercancel", onPointerCancel, { passive: true });

  return () => {
    document.removeEventListener("pointerdown", onPointerDown);
    document.removeEventListener("pointermove", onPointerMove);
    document.removeEventListener("pointerup", onPointerUp);
    document.removeEventListener("pointercancel", onPointerCancel);
  };
});

$effect(() => {
  if (gesturePhase !== "settling") return;

  const timer = window.setTimeout(() => {
    if (gesturePhase === "settling") {
      gesturePhase = "idle";
      if (!uiState.mobileDrawerOpen) {
        dragOffsetPx = 0;
      }
    }
  }, 220);

  return () => window.clearTimeout(timer);
});

// Lock body scroll when drawer is open
$effect(() => {
  if (uiState.mobileDrawerOpen || isDragging) {
    document.body.classList.add("drawer-open");
  } else {
    document.body.classList.remove("drawer-open");
  }
});

onMount(() => {
  hydrateRuntimeStoreFromSidebarCache();
  void authStore.ensureLoaded();

  // Register PWA Service Worker (conservative update: closes all tabs to activate)
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      void navigator.serviceWorker.register("/sw.js");
    });
  }
});
</script>

{#if isLogin}
  <main class="min-h-screen bg-bg-primary text-text-primary">
    {@render children?.()}
  </main>
{:else}
  <div class="h-screen flex flex-col lg:flex-row bg-bg-primary text-text-primary font-sans text-[13px] leading-[1.6]">
    <!-- Desktop sidebar — hidden on mobile -->
    <div class="hidden lg:block">
      <Sidebar />
    </div>

    <!-- Main content area -->
    <main class="flex-1 flex flex-col min-w-0 overflow-hidden mobile-drawer-gesture-surface">

      <!-- Page content -->
      <div class="flex-1 flex flex-col min-w-0 overflow-hidden">
        {@render children?.()}
      </div>
    </main>
  </div>

  <!-- Mobile drawer — outside flex container to avoid stacking context issues -->
  <MobileSidebarDrawer
    dragOffsetPx={dragOffsetPx}
    {isDragging}
    {isDrawerVisible}
  />

  <!-- Global media lightbox -->
  <MediaLightbox />
{/if}
