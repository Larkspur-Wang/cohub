<script lang="ts">
import "../app.css";
import { page } from "$app/state";
import Sidebar from "$lib/components/Sidebar.svelte";
import MobileSidebarDrawer from "$lib/components/MobileSidebarDrawer.svelte";
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

// ─── Swipe gesture for mobile drawer ───
const SWIPE_THRESHOLD = 60;
let touchStartX = $state<number | null>(null);
let touchStartY = $state(0);
let dragProgress = $state(0);
let isDragging = $state(false);

function handleTouchStart(e: TouchEvent) {
  if (window.innerWidth >= 1024) return;
  // Only trigger from the left 20px edge when drawer is closed
  if (!uiState.mobileDrawerOpen && e.touches[0].clientX > 20) return;
  touchStartX = e.touches[0].clientX;
  touchStartY = e.touches[0].clientY;
}

function handleTouchMove(e: TouchEvent) {
  if (touchStartX === null) return;
  const dx = e.touches[0].clientX - touchStartX;
  const dy = e.touches[0].clientY - touchStartY;

  // If drawer is closed and user scrolls vertically, don't capture
  if (!uiState.mobileDrawerOpen && !isDragging) {
    if (Math.abs(dy) > Math.abs(dx)) {
      touchStartX = null;
      return;
    }
    if (dx <= 0) {
      touchStartX = null;
      return;
    }
  }

  // If drawer is open and user swipes left, allow close gesture
  if (uiState.mobileDrawerOpen && !isDragging) {
    if (dx >= 0 || Math.abs(dy) > Math.abs(dx)) {
      touchStartX = null;
      return;
    }
  }

  if (dx > 0 && !uiState.mobileDrawerOpen) {
    isDragging = true;
    dragProgress = Math.min(dx / SWIPE_THRESHOLD, 1);
    if (e.cancelable) e.preventDefault();
  } else if (dx < 0 && uiState.mobileDrawerOpen) {
    isDragging = true;
    dragProgress = Math.max(1 + dx / SWIPE_THRESHOLD, 0);
    if (e.cancelable) e.preventDefault();
  }
}

function handleTouchEnd() {
  if (!isDragging || touchStartX === null) return;
  isDragging = false;
  if (dragProgress > 0.5) {
    uiState.mobileDrawerOpen = true;
  } else {
    uiState.mobileDrawerOpen = false;
  }
  dragProgress = 0;
  touchStartX = null;
  touchStartY = 0;
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

// Register touch gesture listeners on document for reliable capture
$effect(() => {
  function onTouchStart(e: TouchEvent) {
    handleTouchStart(e);
  }
  function onTouchMove(e: TouchEvent) {
    handleTouchMove(e);
  }
  function onTouchEnd() {
    handleTouchEnd();
  }
  document.addEventListener("touchstart", onTouchStart, { passive: true });
  document.addEventListener("touchmove", onTouchMove, { passive: false });
  document.addEventListener("touchend", onTouchEnd, { passive: true });
  return () => {
    document.removeEventListener("touchstart", onTouchStart);
    document.removeEventListener("touchmove", onTouchMove);
    document.removeEventListener("touchend", onTouchEnd);
  };
});

// Lock body scroll when drawer is open
$effect(() => {
  if (uiState.mobileDrawerOpen) {
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
    <main class="flex-1 flex flex-col min-w-0 overflow-hidden">

      <!-- Page content -->
      <div class="flex-1 flex flex-col min-w-0 overflow-hidden">
        {@render children?.()}
      </div>
    </main>
  </div>

  <!-- Mobile drawer — outside flex container to avoid stacking context issues -->
  <MobileSidebarDrawer {dragProgress} {isDragging} />

  <!-- Global media lightbox -->
  <MediaLightbox />
{/if}
