<script lang="ts">
import { FolderKanban, GitFork, Search, Globe } from "lucide-svelte";
import { getPublicWorkspaces, type PublicWorkspace } from "$lib/api";
import { onMount } from "svelte";
import { goto } from "$app/navigation";

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
      goto("/login");
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

<div class="neo-page-shell">
  <div>
    <h1 class="neo-page-title">Explore</h1>
    <p class="neo-page-desc mt-3 max-w-2xl">Discover and fork public workspaces from the community.</p>
  </div>

  <form onsubmit={handleSearch} class="neo-card p-4 bg-white flex flex-col md:flex-row gap-3 md:items-center">
    <div class="relative flex-1">
      <Search class="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4" />
      <input type="text" bind:value={searchQuery} placeholder="Search workspaces..." class="neo-input pl-11" />
    </div>
    <button type="submit" class="neo-btn neo-btn-secondary">Search</button>
  </form>

  {#if isLoading}
    <div class="neo-loading">Loading workspaces...</div>
  {:else if loadError}
    <div class="neo-error">
      <h2 class="neo-section-title text-white">Load Failed</h2>
      <p class="mt-2 text-sm font-bold break-all">{loadError}</p>
    </div>
  {:else if workspaces.length === 0}
    <div class="neo-empty">
      <div class="neo-icon-box neo-fill-yellow mx-auto mb-4"><Globe class="w-5 h-5" /></div>
      <h3 class="neo-section-title">No Public Workspaces Found</h3>
      <p class="neo-page-desc mt-3 text-sm">{searchQuery ? "Try a different search term." : "Be the first to make a workspace public."}</p>
    </div>
  {:else}
    <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
      {#each workspaces as workspace}
        <a href="/workspaces/{workspace.id}" class="neo-list-card p-4 bg-white flex flex-col gap-4">
          <div class="flex items-start justify-between gap-3">
            <div class="neo-icon-box neo-fill-green"><FolderKanban class="w-5 h-5" /></div>
            <span class="neo-badge neo-badge-green"><Globe class="w-3 h-3" /> Public</span>
          </div>
          <div>
            <h3 class="text-lg font-black uppercase tracking-tight truncate">{workspace.name}</h3>
            <p class="mt-2 text-sm font-bold text-black/60 line-clamp-2 min-h-[2.5rem]">{workspace.description || "No description provided."}</p>
          </div>
          <div class="mt-auto flex items-center justify-between gap-3 border-t-[3px] border-black pt-3 text-[11px] font-bold text-black/55">
            <div class="flex items-center gap-3 min-w-0">
              <span class="font-mono truncate">{workspace.giteaRepoName}</span>
              {#if workspace.forkCount > 0}
                <span class="inline-flex items-center gap-1 shrink-0"><GitFork class="w-3 h-3" /> {workspace.forkCount}</span>
              {/if}
            </div>
            <span class="shrink-0">{new Date(workspace.createdAt).toLocaleDateString()}</span>
          </div>
        </a>
      {/each}
    </div>

    {#if totalPages > 1}
      <div class="flex items-center justify-center gap-3 flex-wrap">
        <button onclick={() => goToPage(page - 1)} disabled={page === 1} class="neo-btn neo-btn-secondary disabled:opacity-50">Previous</button>
        <span class="neo-badge neo-badge-white normal-case tracking-normal">Page {page} / {totalPages} · {total} total</span>
        <button onclick={() => goToPage(page + 1)} disabled={page === totalPages} class="neo-btn neo-btn-secondary disabled:opacity-50">Next</button>
      </div>
    {/if}
  {/if}
</div>
