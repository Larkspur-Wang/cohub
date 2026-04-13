<script lang="ts">
import { uiState } from "$lib/stores/ui.svelte";
import Sidebar from "$lib/components/Sidebar.svelte";

const {
  dragProgress = 0,
  isDragging = false,
}: { dragProgress?: number; isDragging?: boolean } = $props();

const DRAWER_WIDTH_PX = 280;
const TRANSITION_CSS = "transform 200ms cubic-bezier(0.16, 1, 0.3, 1)";
const TRANSITION_DURATION_MS = 200;

const panelStyle = $derived.by(() => {
  if (isDragging) {
    const offset = DRAWER_WIDTH_PX * (1 - dragProgress);
    return `transform: translateX(-${offset}px); transition: none;`;
  }
  if (uiState.mobileDrawerOpen) {
    return `transform: translateX(0); transition: ${TRANSITION_CSS};`;
  }
  return `transform: translateX(-${DRAWER_WIDTH_PX}px); transition: none; pointer-events: none;`;
});

const backdropStyle = $derived.by(() => {
  if (isDragging) {
    return `opacity: ${dragProgress * 0.5}; transition: none;`;
  }
  if (uiState.mobileDrawerOpen) {
    return "opacity: 0.5; transition: opacity 200ms cubic-bezier(0.16, 1, 0.3, 1);";
  }
  return "opacity: 0; transition: none; pointer-events: none;";
});

function closeDrawer() {
  uiState.mobileDrawerOpen = false;
}

// Track whether Sidebar content should be rendered.
// Opens immediately; closes after transition finishes so the slide-out isn't empty.
let renderContent = $state(false);

$effect(() => {
  if (uiState.mobileDrawerOpen) {
    renderContent = true;
  } else {
    const timer = setTimeout(() => {
      renderContent = false;
    }, TRANSITION_DURATION_MS);
    return () => clearTimeout(timer);
  }
});
</script>

<!-- Mobile sidebar drawer — always mounted, visibility controlled via CSS -->
<div
  class="lg:hidden fixed inset-0 z-50"
  style="pointer-events: none;"
  aria-hidden={!uiState.mobileDrawerOpen}
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
    style="pointer-events: auto; width: {DRAWER_WIDTH_PX}px; max-width: 85vw; {panelStyle}"
  >
    {#if renderContent}
      <div class="h-full border-r border-border-subtle bg-bg-primary">
        <Sidebar isMobile onClose={closeDrawer} />
      </div>
    {/if}
  </div>
</div>
