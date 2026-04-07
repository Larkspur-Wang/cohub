<script lang="ts">
import { slide, fade } from "svelte/transition";
import { uiState } from "$lib/stores/ui.svelte";
import Sidebar from "$lib/components/Sidebar.svelte";

function closeDrawer() {
  uiState.mobileDrawerOpen = false;
}
</script>

<!-- Mobile sidebar drawer — visible only below lg when open -->
{#if uiState.mobileDrawerOpen}
  <div
    class="lg:hidden fixed inset-0 z-50"
    in:fade={{ duration: 150 }}
    out:fade={{ duration: 150 }}
  >
    <!-- Backdrop -->
    <div
      class="absolute inset-0 bg-black/50"
      onclick={closeDrawer}
      aria-hidden="true"
    ></div>

    <!-- Drawer panel -->
    <div
      class="absolute inset-y-0 left-0 w-[280px] max-w-[85vw]"
      in:slide={{ axis: "x", duration: 200, easing: (t) => t }}
      out:slide={{ axis: "x", duration: 150, easing: (t) => t * t }}
    >
      <div class="h-full border-r border-border-subtle bg-bg-primary">
        <Sidebar isMobile onClose={closeDrawer} />
      </div>
    </div>
  </div>
{/if}
