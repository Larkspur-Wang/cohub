<script lang="ts">
  import '../app.css';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { clearAuthToken } from '$lib/api';

  let { children } = $props();

  async function handleLogout() {
    try {
      await clearAuthToken();
    } finally {
      goto('/login');
    }
  }

  let currentPath = $derived(page.url.pathname);
  let isAuthenticated = $derived(currentPath !== '/login');
</script>

<div class="min-h-screen flex flex-col bg-[var(--bg-primary)]">
  <header class="sticky top-0 z-40 bg-[var(--bg-primary)]/80 backdrop-blur-xl border-b border-gray-100">
    <div class="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
      <a href="/" class="flex items-center gap-3 group">
        <div class="w-10 h-10 bg-brand text-white rounded-xl flex items-center justify-center font-black text-xl shadow-lg shadow-brand/20 group-hover:rotate-12 transition-transform">
          N
        </div>
        <span class="text-xl font-black tracking-tighter text-gray-800">Netaverses <span class="text-brand">Studio</span></span>
      </a>

      {#if isAuthenticated}
        <nav class="hidden md:flex items-center gap-8 bg-white px-6 py-3 rounded-full border border-gray-100 shadow-sm font-medium text-sm">
          <a href="/" class="{currentPath === '/' ? 'text-brand font-bold' : 'text-gray-500 hover:text-gray-900'} transition-colors">Home</a>
          <a href="/worlds" class="{currentPath.startsWith('/worlds') ? 'text-brand font-bold' : 'text-gray-500 hover:text-gray-900'} transition-colors">Worlds</a>
          <a href="/agents" class="{currentPath.startsWith('/agents') ? 'text-brand font-bold' : 'text-gray-500 hover:text-gray-900'} transition-colors">Agents</a>
        </nav>

        <div class="flex items-center gap-4">
          <div class="w-10 h-10 rounded-full bg-gray-100 border-2 border-white shadow-sm overflow-hidden cursor-pointer hover:border-brand transition-colors" title="Settings">
            <img src="https://api.dicebear.com/7.x/notionists/svg?seed=neta-user" alt="avatar" class="w-full h-full object-cover" />
          </div>
          <button
            onclick={handleLogout}
            class="text-xs font-bold text-gray-400 hover:text-red-500 uppercase tracking-widest transition-colors"
          >
            Exit
          </button>
        </div>
      {:else if currentPath !== '/login'}
        <a
          href="/login"
          class="px-6 py-2.5 bg-brand text-white text-sm font-bold rounded-full hover:bg-brand/90 transition-colors shadow-lg shadow-brand/20"
        >
          Authenticate
        </a>
      {/if}
    </div>
  </header>

  <main class="flex-grow">
    {@render children?.()}
  </main>

  <footer class="border-t border-gray-100 py-12 text-center text-gray-400 text-sm font-medium">
    <p>© {new Date().getFullYear()} Netaverses Protocol. <br /><span class="opacity-50 text-xs italic">Simulate carefully.</span></p>
  </footer>
</div>
