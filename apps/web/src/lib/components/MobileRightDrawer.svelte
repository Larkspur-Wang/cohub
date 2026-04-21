<script lang="ts">
import { DURATION_DRAWER_IN, DURATION_DRAWER_OUT, EASE_OUT, EASE_IN } from "$lib/motion.svelte";
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
  children,
}: {
  dragOffsetPx?: number;
  isDragging?: boolean;
  isDrawerVisible?: boolean;
  children: import("svelte").Snippet;
} = $props();

const TRANSITION_CSS = `transform ${DURATION_DRAWER_IN}ms ${EASE_OUT}`;
const CLOSE_TRANSITION_CSS = `transform ${DURATION_DRAWER_OUT}ms ${EASE_IN}`;
const BACKDROP_TRANSITION_CSS = `opacity ${DURATION_DRAWER_IN}ms ${EASE_OUT}`;
const CLOSE_BACKDROP_TRANSITION_CSS = `opacity ${DURATION_DRAWER_OUT}ms ${EASE_IN}`;
const TRANSITION_DURATION_MS = DURATION_DRAWER_OUT;

const openRatio = $derived(getDrawerOpenRatio(dragOffsetPx));

const panelStyle = $derived.by(() => {
  if (isDragging) {
    const offset = MOBILE_DRAWER_WIDTH_PX - dragOffsetPx;
    return `transform: translateX(${offset}px); transition: none;`;
  }
  if (uiState.mobileRightDrawerOpen) {
    return `transform: translateX(0); transition: ${TRANSITION_CSS};`;
  }
  return `transform: translateX(${MOBILE_DRAWER_WIDTH_PX}px); transition: ${CLOSE_TRANSITION_CSS}; pointer-events: none;`;
});

const backdropStyle = $derived.by(() => {
  if (isDragging) {
    return `opacity: ${openRatio * 0.5}; transition: none;`;
  }
  if (uiState.mobileRightDrawerOpen) {
    return `opacity: 0.5; transition: ${BACKDROP_TRANSITION_CSS};`;
  }
  return `opacity: 0; transition: ${CLOSE_BACKDROP_TRANSITION_CSS}; pointer-events: none;`;
});

function closeDrawer() {
  uiState.mobileRightDrawerOpen = false;
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

<!-- Mobile right sidebar drawer — always mounted, visibility controlled via CSS -->
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
    class="absolute inset-y-0 right-0"
    style="pointer-events: auto; width: {MOBILE_DRAWER_WIDTH_PX}px; max-width: {MOBILE_DRAWER_MAX_WIDTH_VW}vw; {panelStyle}"
  >
    {#if renderContent}
      <div class="h-full border-l border-border-subtle bg-bg-primary">
        {@render children()}
      </div>
    {/if}
  </div>
</div>
