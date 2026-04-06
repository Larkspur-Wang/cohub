<script lang="ts">
import { FolderKanban, GitFork, Search, Globe } from "lucide-svelte";
import { getPublicWorkspaces, type PublicWorkspace } from "$lib/api";
import { onMount } from "svelte";
import { logtoClient } from "$lib/auth";

let workspaces = $state<PublicWorkspace[]>([]);
let isLoading = $state(true);
let loadError = $state("");

let searchQuery = $state("");
let page = $state(1);
let totalPages = $state(1);
let total = $state(0);

async function loadData() {
  isLoading = true;
  loadError = "";
  try {
    const response = await getPublicWorkspaces(page, 20, searchQuery || undefined);
    workspaces = response.items;
    total = response.pagination.total;
    totalPages = response.pagination.totalPages;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load public workspaces";
    if (message.includes("unauthorized") || message.includes("401")) {
      await logtoClient.signIn(`${window.location.origin}/callback`);
      return;
    }
    loadError = message;
  } finally {
    isLoading = false;
  }
}

onMount(() => {
  loadData();
});

function handleSearch(e: Event) {
  e.preventDefault();
  page = 1;
  loadData();
}

function goToPage(newPage: number) {
  if (newPage < 1 || newPage > totalPages) return;
  page = newPage;
  loadData();
}
</script>

<div class="flex-1 flex flex-col min-h-0 overflow-y-auto">
  <!-- Header -->
  <div class="h-10 flex items-center px-4 border-b border-border-primary shrink-0 bg-bg-primary">
    <span class="text-xs font-medium text-text-secondary">Explore</span>
  </div>

  <div class="flex-1 p-4 overflow-y-auto">
    <!-- Search -->
    <form onsubmit={handleSearch} class="mb-4 flex gap-2">
      <div class="relative flex-1">
        <Search class="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-placeholder" />
        <input
          type="text"
          bind:value={searchQuery}
          placeholder="Search public workspaces..."
          class="w-full pl-8 pr-3 py-1.5 rounded-md bg-bg-input border border-border-primary text-xs text-text-primary placeholder:text-text-placeholder focus:border-border-primary/30 focus:outline-none"
        />
      </div>
      <button type="submit" class="px-3 py-1.5 rounded-md bg-hover hover:bg-hover-strong border border-border-primary text-xs text-text-secondary hover:text-text-primary transition-colors">
        Search
      </button>
    </form>

    {#if isLoading}
      <div class="flex items-center justify-center py-12 text-xs text-text-tertiary">
        <div class="w-4 h-4 rounded-full border-2 border-border-primary border-t-emerald-400 animate-spin mr-2"></div>
        Loading...
      </div>
    {:else if loadError}
      <div class="rounded-md border border-rose-500/20 bg-rose-500/10 p-3 text-xs font-mono text-rose-400 break-all">{loadError}</div>
    {:else if workspaces.length === 0}
      <div class="flex flex-col items-center justify-center py-12 text-center">
        <div class="w-10 h-10 rounded-full bg-hover border border-border-primary flex items-center justify-center mb-3">
          <Globe class="w-4 h-4 text-text-placeholder" />
        </div>
        <p class="text-sm text-text-tertiary">No public workspaces found</p>
        <p class="text-xs text-text-placeholder mt-1">{searchQuery ? "Try a different search term" : "Be the first to make a workspace public"}</p>
      </div>
    {:else}
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {#each workspaces as workspace}
          <a
            href="/workspaces/{workspace.id}"
            class="group block p-3 rounded-lg border border-border-primary bg-bg-surface hover:border-border-primary/20 hover:bg-bg-surface-hover transition-colors"
          >
            <div class="flex items-start justify-between gap-2 mb-2">
              <div class="w-8 h-8 rounded-md bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center shrink-0">
                <Globe class="w-4 h-4 text-emerald-400/70" />
              </div>
              <span class="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-emerald-500/10 text-emerald-400/70 border border-emerald-500/20">
                <Globe class="w-2.5 h-2.5" />
              </span>
            </div>

            <h3 class="text-sm font-medium text-text-primary truncate">{workspace.name}</h3>
            <p class="mt-1 text-xs text-text-tertiary line-clamp-2 min-h-[2rem]">{workspace.description || "No description"}</p>

            <div class="mt-3 pt-2 border-t border-border-subtle flex items-center justify-between text-[10px] text-text-placeholder font-mono">
              <span class="truncate">{workspace.giteaRepoName}</span>
              {#if workspace.forkCount > 0}
                <span class="flex items-center gap-1 shrink-0"><GitFork class="w-2.5 h-2.5" /> {workspace.forkCount}</span>
              {/if}
            </div>
          </a>
        {/each}
      </div>

      {#if totalPages > 1}
        <div class="flex items-center justify-center gap-3 mt-4">
          <button
            onclick={() => goToPage(page - 1)}
            disabled={page === 1}
            class="px-3 py-1.5 rounded-md bg-hover hover:bg-hover-strong border border-border-primary text-xs text-text-tertiary hover:text-text-secondary transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            Previous
          </button>
          <span class="text-[10px] text-text-tertiary">Page {page} / {totalPages} · {total} total</span>
          <button
            onclick={() => goToPage(page + 1)}
            disabled={page === totalPages}
            class="px-3 py-1.5 rounded-md bg-hover hover:bg-hover-strong border border-border-primary text-xs text-text-tertiary hover:text-text-secondary transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            Next
          </button>
        </div>
      {/if}
    {/if}
  </div>
</div>
