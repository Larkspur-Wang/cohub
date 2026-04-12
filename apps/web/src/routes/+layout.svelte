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
  <MobileSidebarDrawer />

  <!-- Global media lightbox -->
  <MediaLightbox />
{/if}
