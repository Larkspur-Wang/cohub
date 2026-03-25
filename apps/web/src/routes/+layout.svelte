<script lang="ts">
import "../app.css";
import { goto } from "$app/navigation";
import { page } from "$app/state";
import { clearAuthToken } from "$lib/api";
import { LayoutDashboard, FolderKanban, Network, Cpu, LogOut, Settings, Globe } from "lucide-svelte";

const { children } = $props();

async function handleLogout() {
  try {
    await clearAuthToken();
  } finally {
    goto("/login");
  }
}

const currentPath = $derived(page.url.pathname);
const isLogin = $derived(currentPath === "/login");

const navItems = [
  { name: "Overview", href: "/", icon: LayoutDashboard },
  { name: "Explore", href: "/explore", icon: Globe },
  { name: "Workspaces", href: "/workspaces", icon: FolderKanban },
  { name: "Runtimes", href: "/runtimes", icon: Cpu },
  { name: "Channels", href: "/channels", icon: Network },
];
</script>

{#if isLogin}
  <main class="min-h-screen bg-[var(--bg-primary)]">
    {@render children?.()}
  </main>
{:else}
  <div class="min-h-screen flex bg-[var(--bg-primary)]">
    <!-- Sidebar -->
    <aside class="w-64 border-r border-gray-200 bg-white flex flex-col h-screen sticky top-0">
      <div class="h-16 flex items-center px-6 border-b border-gray-100">
        <a href="/" class="flex items-center gap-2 group" aria-label="Cohub Studio">
          <div class="w-8 h-8 bg-brand text-white rounded-lg flex items-center justify-center font-black text-sm shadow-sm">
            N
          </div>
          <span class="font-bold tracking-tight text-gray-900">Cohub <span class="text-brand">Studio</span></span>
        </a>
      </div>

      <div class="flex-1 overflow-y-auto py-6 px-4">
        <div class="space-y-1">
          <div class="px-2 mb-2 text-xs font-semibold text-gray-400 uppercase tracking-wider">
            Menu
          </div>
          {#each navItems as item}
            {@const isActive = item.href === '/' ? currentPath === '/' : currentPath.startsWith(item.href)}
            <a
              href={item.href}
              class="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors {isActive ? 'bg-brand/10 text-brand' : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'}"
            >
              <item.icon class="w-4 h-4 {isActive ? 'text-brand' : 'text-gray-400'}" />
              {item.name}
            </a>
          {/each}
        </div>
      </div>

      <div class="p-4 border-t border-gray-100">
        <div class="flex items-center gap-3 px-3 py-3 rounded-xl bg-gray-50 border border-gray-100">
          <div class="w-8 h-8 rounded-full bg-white border border-gray-200 overflow-hidden shrink-0">
            <img src="https://api.dicebear.com/7.x/notionists/svg?seed=neta-user" alt="avatar" class="w-full h-full object-cover" />
          </div>
          <div class="flex-1 min-w-0">
            <p class="text-sm font-medium text-gray-900 truncate">Admin</p>
            <p class="text-xs text-gray-500 truncate">Studio Access</p>
          </div>
          <button
            onclick={handleLogout}
            class="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
            title="Logout"
          >
            <LogOut class="w-4 h-4" />
          </button>
        </div>
      </div>
    </aside>

    <!-- Main Content -->
    <main class="flex-1 flex flex-col min-w-0 min-h-screen">
      <!-- Topbar (Optional, for breadcrumbs/actions) -->
      <header class="h-16 flex items-center px-8 border-b border-gray-100 bg-white/50 backdrop-blur-sm sticky top-0 z-10">
        <!-- Breadcrumb or Context Title could go here -->
        <div class="flex-1"></div>
      </header>
      
      <div class="flex-1 p-8 overflow-y-auto">
        <div class="max-w-6xl mx-auto">
          {@render children?.()}
        </div>
      </div>
    </main>
  </div>
{/if}
