<script lang="ts">
import "../app.css";
import { page } from "$app/state";
import Sidebar from "$lib/components/Sidebar.svelte";
import { getResolvedTheme } from "$lib/theme";

const { children } = $props();

const currentPath = $derived(page.url.pathname);
const isLogin = $derived(currentPath === "/callback");
const resolvedTheme = $derived(getResolvedTheme());
</script>

{#if isLogin}
  <main class="min-h-screen bg-bg-primary text-text-primary">
    {@render children?.()}
  </main>
{:else}
  <div class="h-screen flex bg-bg-primary text-text-secondary font-sans text-sm">
    <Sidebar />
    <main class="flex-1 flex flex-col min-w-0 overflow-hidden">
      {@render children?.()}
    </main>
  </div>
{/if}
