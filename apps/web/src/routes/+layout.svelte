<script lang="ts">
import "../app.css";
import { page } from "$app/state";
import { logtoClient } from "$lib/auth";
import { LayoutDashboard, FolderKanban, Network, Cpu, LogOut, Globe, Menu, X, Settings } from "lucide-svelte";
import { fade, slide } from "svelte/transition";
import { onMount } from "svelte";
import type { IdTokenClaims } from "@logto/browser";

const { children } = $props();

let isMobileMenuOpen = $state(false);
let userClaims = $state<IdTokenClaims | null>(null);

onMount(async () => {
  const authenticated = await logtoClient.isAuthenticated();
  if (authenticated) {
    try {
      userClaims = await logtoClient.getIdTokenClaims();
    } catch {
      // ignore
    }
  }
});

// Auth is now handled per-page:
// - Public pages: /callback, /explore, /workspaces/[id] (public workspaces only)
// - Protected pages: all others call ensureAuth() on mount

async function handleLogout() {
  await logtoClient.signOut(`${window.location.origin}/`);
}

const currentPath = $derived(page.url.pathname);
const isLogin = $derived(currentPath === "/callback");
const isRuntimeDetail = $derived(/^\/runtimes\/[^/]+$/.test(currentPath));

const navItems = [
  { name: "Overview", href: "/", icon: LayoutDashboard, color: "bg-[#FFD93D]" },
  { name: "Explore", href: "/explore", icon: Globe, color: "bg-[#4D96FF]" },
  { name: "Workspaces", href: "/workspaces", icon: FolderKanban, color: "bg-[#28B463]" },
  { name: "Runtimes", href: "/runtimes", icon: Cpu, color: "bg-[#FF85B3]" },
  { name: "Channels", href: "/channels", icon: Network, color: "bg-[#9D4EDD]" },
  { name: "Settings", href: "/settings", icon: Settings, color: "bg-[#FF5A5F]" },
];
</script>

{#if isLogin}
  <main class="min-h-screen bg-[#FFF9F0] text-black selection:bg-black selection:text-white">
    {@render children?.()}
  </main>
{:else if isRuntimeDetail}
  <main class="h-screen overflow-hidden bg-black text-white selection:bg-white/20">
    {@render children?.()}
  </main>
{:else}
  <div class="min-h-screen flex flex-col md:flex-row bg-[#FFF9F0] text-black selection:bg-black selection:text-white font-sans overflow-x-hidden">
    <aside class="hidden md:flex w-64 border-r-[3px] border-black bg-[#FFF9F0] flex-col h-screen sticky top-0 z-40">
      <div class="h-20 flex items-center px-6 border-b-[3px] border-black">
        <a href="/" class="flex items-center gap-3 group translate-y-[-2px] hover:translate-y-0 transition-transform active:translate-y-1" aria-label="Cohub">
          <div class="w-11 h-11 bg-[#FF5A5F] border-[3px] border-black rounded-2xl flex items-center justify-center font-black text-xl shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] group-hover:shadow-none group-hover:translate-x-1 group-hover:translate-y-1 transition-all">
            C
          </div>
          <span class="font-black text-2xl tracking-tighter uppercase leading-none">Cohub</span>
        </a>
      </div>

      <div class="flex-1 overflow-y-auto py-6 px-4">
        <nav class="space-y-3">
          {#each navItems as item}
            {@const isActive = item.href === '/' ? currentPath === '/' : currentPath.startsWith(item.href)}
            <a
              href={item.href}
              class="flex items-center gap-3 px-3 py-3 rounded-2xl border-[3px] border-black font-black text-sm uppercase tracking-tight transition-all duration-200 group {isActive ? `${item.color} shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]` : 'bg-white hover:bg-gray-50 hover:shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:-translate-x-1 hover:-translate-y-1 active:translate-x-0 active:translate-y-0 active:shadow-none'}"
            >
              <div class="p-2 rounded-xl border-2 border-black bg-white group-hover:scale-110 transition-transform">
                <item.icon class="w-4 h-4" />
              </div>
              <span>{item.name}</span>
            </a>
          {/each}
        </nav>
      </div>

      <div class="p-4 border-t-[3px] border-black">
        <div class="flex items-center gap-3 p-3 rounded-3xl border-[3px] border-black bg-[#FFD93D] shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
          <div class="w-10 h-10 rounded-2xl border-[3px] border-black bg-white overflow-hidden shrink-0">
            {#if userClaims?.picture}
              <img src={userClaims.picture} alt="avatar" class="w-full h-full object-cover" />
            {:else}
              <img src="https://api.dicebear.com/7.x/notionists/svg?seed={userClaims?.sub ?? 'anonymous'}" alt="avatar" class="w-full h-full object-cover" />
            {/if}
          </div>
          <div class="flex-1 min-w-0">
            <p class="font-black text-sm truncate uppercase tracking-tighter">{userClaims?.name ?? 'Guest'}</p>
            <p class="text-[10px] font-bold uppercase tracking-widest opacity-60">{userClaims?.email ?? 'Not signed in'}</p>
          </div>
          <button
            onclick={handleLogout}
            class="p-2 bg-white border-[3px] border-black rounded-xl hover:bg-[#FF5A5F] hover:shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] active:translate-x-0.5 active:translate-y-0.5 active:shadow-none transition-all"
          >
            <LogOut class="w-4 h-4" />
          </button>
        </div>
      </div>
    </aside>

    <header class="md:hidden h-18 flex items-center justify-between px-5 border-b-[3px] border-black bg-[#FFF9F0] sticky top-0 z-50">
      <a href="/" class="flex items-center gap-2">
        <div class="w-10 h-10 bg-[#FF5A5F] border-[3px] border-black rounded-xl flex items-center justify-center font-black text-lg">C</div>
        <span class="font-black text-lg uppercase tracking-tighter">Cohub</span>
      </a>
      <button 
        onclick={() => isMobileMenuOpen = !isMobileMenuOpen}
        class="p-2 border-[3px] border-black rounded-xl bg-[#FFD93D] shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] active:shadow-none active:translate-x-0.5 active:translate-y-0.5 transition-all"
      >
        {#if isMobileMenuOpen}<X class="w-5 h-5" />{:else}<Menu class="w-5 h-5" />{/if}
      </button>
    </header>

    {#if isMobileMenuOpen}
      <div 
        transition:slide
        class="md:hidden bg-[#FFF9F0] border-b-[3px] border-black px-5 py-5 space-y-3 z-40 sticky top-[72px]"
      >
        {#each navItems as item}
          {@const isActive = item.href === '/' ? currentPath === '/' : currentPath.startsWith(item.href)}
          <a
            href={item.href}
            onclick={() => isMobileMenuOpen = false}
            class="flex items-center gap-3 p-3 rounded-2xl border-[3px] border-black font-black uppercase tracking-tight {isActive ? `${item.color} shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]` : 'bg-white shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]'}"
          >
            <item.icon class="w-4 h-4" />
            {item.name}
          </a>
        {/each}
      </div>
    {/if}

    <main class="flex-1 flex flex-col min-w-0 min-h-screen relative z-10">
      <div class="flex-1 p-5 md:p-8 overflow-y-auto">
        <div class="max-w-6xl mx-auto" in:fade={{ duration: 300 }}>
          {@render children?.()}
        </div>
      </div>
    </main>
  </div>
{/if}
