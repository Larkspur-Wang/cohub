<script lang="ts">
import "../app.css";
import { page } from "$app/state";
import Sidebar from "$lib/components/Sidebar.svelte";

const { children } = $props();

const currentPath = $derived(page.url.pathname);
const isLogin = $derived(currentPath === "/callback");
</script>

{#if isLogin}
  <main class="min-h-screen bg-[#0A0A0A] text-white">
    {@render children?.()}
  </main>
{:else}
  <div class="h-screen flex bg-[#0A0A0A] text-white/80 font-sans text-sm selection:bg-white/20">
    <Sidebar />
    <main class="flex-1 flex flex-col min-w-0 overflow-hidden">
      {@render children?.()}
    </main>
  </div>
{/if}
