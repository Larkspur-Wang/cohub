<script lang="ts">
import "../app.css";
import { page } from "$app/state";
import Sidebar from "$lib/components/Sidebar.svelte";
import MobileHeader from "$lib/components/MobileHeader.svelte";
import MobileTabBar from "$lib/components/MobileTabBar.svelte";
import MobileSidebarDrawer from "$lib/components/MobileSidebarDrawer.svelte";
import { getResolvedTheme } from "$lib/theme";
import { onMount } from "svelte";
import { uiState } from "$lib/stores/ui.svelte";
import MediaLightbox from "$lib/components/MediaLightbox.svelte";

const { children } = $props();

const currentPath = $derived(page.url.pathname);
const isLogin = $derived(currentPath === "/callback");
const resolvedTheme = $derived(getResolvedTheme());

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

// Lock body scroll when drawer is open
$effect(() => {
  if (uiState.mobileDrawerOpen) {
    document.body.classList.add("drawer-open");
  } else {
    document.body.classList.remove("drawer-open");
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

    <!-- Mobile components -->
    <MobileSidebarDrawer />

    <!-- Main content area -->
    <main class="flex-1 flex flex-col min-w-0 overflow-hidden">
      <!-- Mobile header — only visible below lg -->
      <MobileHeader />

      <!-- Page content -->
      <div class="flex-1 flex flex-col min-w-0 overflow-hidden">
        {@render children?.()}
      </div>

      <!-- Mobile bottom tab bar — only visible below lg -->
      <MobileTabBar />
    </main>

    <!-- Global media lightbox -->
    <MediaLightbox />
  </div>
{/if}
