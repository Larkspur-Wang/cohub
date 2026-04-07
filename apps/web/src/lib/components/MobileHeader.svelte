<script lang="ts">
import { page } from "$app/state";
import { Menu } from "lucide-svelte";
import { uiState } from "$lib/stores/ui.svelte";
import type { Snippet } from "svelte";

const { actionButtons }: { actionButtons?: Snippet } = $props();

const currentPath = $derived(page.url.pathname);

const pageTitle = $derived.by(() => {
  if (currentPath === "/") return "Overview";
  if (currentPath.startsWith("/workspaces")) return "Workspaces";
  if (currentPath.startsWith("/runtimes/new")) return "New Runtime";
  if (currentPath.startsWith("/runtimes")) return "Runtimes";
  if (currentPath.startsWith("/channels")) return "Channels";
  if (currentPath.startsWith("/settings")) return "Settings";
  if (currentPath.startsWith("/explore")) return "Explore";
  if (currentPath.startsWith("/callback")) return "Auth";
  return "";
});

function toggleDrawer() {
  uiState.mobileDrawerOpen = !uiState.mobileDrawerOpen;
}

// Close drawer when navigating away from the page
$effect(() => {
  currentPath;
  if (uiState.mobileDrawerOpen) {
    uiState.mobileDrawerOpen = false;
  }
});
</script>

<!-- Mobile top header — visible only below lg breakpoint -->
<header
  class="lg:hidden sticky top-0 z-30 flex items-center justify-between h-11 px-3 border-b border-border-subtle bg-bg-primary shrink-0 safe-top"
>
  <div class="flex items-center gap-2 min-w-0">
    <button
      type="button"
      class="flex items-center justify-center w-8 h-8 rounded-[5px] text-text-tertiary hover:text-text-secondary hover:bg-bg-hover transition-colors shrink-0"
      onclick={toggleDrawer}
      aria-label="Toggle navigation"
    >
      <Menu class="w-5 h-5" />
    </button>
    <span class="text-[13px] font-medium text-text-primary truncate">{pageTitle}</span>
  </div>

  <div class="flex items-center gap-1 shrink-0">
    {#if actionButtons}
      {@render actionButtons()}
    {/if}
  </div>
</header>
