<script lang="ts">
import Sidebar from "$lib/components/Sidebar.svelte";
import {
  MOBILE_DRAWER_MAX_WIDTH_VW,
  MOBILE_DRAWER_WIDTH_PX,
  getDrawerOpenRatio,
} from "$lib/gestures/drawer-swipe";
import { uiState } from "$lib/stores/ui.svelte";

const {
  dragOffsetPx = 0,
  isDragging = false,
  isDrawerVisible = false,
  mode = "space",
}: {
  dragOffsetPx?: number;
  isDragging?: boolean;
  isDrawerVisible?: boolean;
  mode?: "space" | "settings";
} = $props();

const TRANSITION_CSS = "transform 220ms cubic-bezier(0.16, 1, 0.3, 1)";
const BACKDROP_TRANSITION_CSS = "opacity 220ms cubic-bezier(0.16, 1, 0.3, 1)";
const TRANSITION_DURATION_MS = 220;

const openRatio = $derived(getDrawerOpenRatio(dragOffsetPx));

const panelStyle = $derived.by(() => {
  if (isDragging) {
    const offset = MOBILE_DRAWER_WIDTH_PX - dragOffsetPx;
    return `transform: translateX(-${offset}px); transition: none;`;
  }
  if (uiState.mobileDrawerOpen) {
    return `transform: translateX(0); transition: ${TRANSITION_CSS};`;
  }
  return `transform: translateX(-${MOBILE_DRAWER_WIDTH_PX}px); transition: ${TRANSITION_CSS}; pointer-events: none;`;
});

const backdropStyle = $derived.by(() => {
  if (isDragging) {
    return `opacity: ${openRatio * 0.5}; transition: none;`;
  }
  if (uiState.mobileDrawerOpen) {
    return `opacity: 0.5; transition: ${BACKDROP_TRANSITION_CSS};`;
  }
  return `opacity: 0; transition: ${BACKDROP_TRANSITION_CSS}; pointer-events: none;`;
});


function closeDrawer() {
  uiState.mobileDrawerOpen = false;
}

let renderContent = $state(false);

$effect(() => {
  if (isDrawerVisible) {
    renderContent = true;
    return;
  }

  const timer = window.setTimeout(() => {
    renderContent = false;
  }, TRANSITION_DURATION_MS);
  return () => window.clearTimeout(timer);
});
</script>

<!-- Mobile sidebar drawer — always mounted, visibility controlled via CSS -->
<div
  class="lg:hidden fixed inset-0 z-50"
  style="pointer-events: none;"
  aria-hidden={!isDrawerVisible}
>
  <!-- Backdrop -->
  <div
    class="absolute inset-0 bg-black"
    style="pointer-events: auto; {backdropStyle}"
    aria-hidden="true"
    onclick={closeDrawer}
  ></div>

  <!-- Drawer panel -->
  <div
    class="absolute inset-y-0 left-0"
    style="pointer-events: auto; width: {MOBILE_DRAWER_WIDTH_PX}px; max-width: {MOBILE_DRAWER_MAX_WIDTH_VW}vw; {panelStyle}"
  >
    {#if renderContent}
      <div class="h-full border-r border-border-subtle bg-bg-primary">
        <Sidebar isMobile mode={mode} onClose={closeDrawer} />
      </div>
    {/if}
  </div>
</div>
