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

<div class="space-y-8">
  <div class="flex items-center justify-between">
    <div>
      <h1 class="text-3xl font-bold tracking-tight text-gray-900">Explore</h1>
      <p class="mt-2 text-sm text-gray-500">Discover and fork public workspaces from the community.</p>
    </div>
  </div>

  <form onsubmit={handleSearch} class="flex gap-2 max-w-md">
    <div class="relative flex-1">
      <Search class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
      <input
        type="text"
        bind:value={searchQuery}
        placeholder="Search workspaces..."
        class="w-full pl-10 pr-4 py-2 bg-white border border-gray-200 rounded-xl focus:ring-2 focus:ring-brand focus:border-brand outline-none text-sm"
      />
    </div>
    <button
      type="submit"
      class="px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-xl hover:bg-gray-800 transition-colors"
    >
      Search
    </button>
  </form>

  {#if isLoading}
    <div class="bg-white border border-gray-200 rounded-2xl p-8 text-sm text-gray-500">Loading workspaces...</div>
  {:else if loadError}
    <div class="bg-red-50 border border-red-200 text-red-700 p-6 rounded-2xl">
      <h2 class="text-lg font-semibold mb-2">Failed to load workspaces</h2>
      <p class="text-sm break-all">{loadError}</p>
    </div>
  {:else if workspaces.length === 0}
    <div class="text-center py-16 bg-white border border-gray-200 border-dashed rounded-3xl">
      <div class="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-4">
        <Globe class="w-8 h-8 text-gray-400" />
      </div>
      <h3 class="text-lg font-medium text-gray-900 mb-1">No public workspaces found</h3>
      <p class="text-sm text-gray-500">
        {searchQuery ? "Try a different search term." : "Be the first to make a workspace public!"}
      </p>
    </div>
  {:else}
    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {#each workspaces as workspace}
        <a href="/workspaces/{workspace.owner}/{workspace.giteaRepoName}" class="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 flex flex-col group hover:border-brand/30 transition-colors">
          <div class="flex items-start justify-between mb-4">
            <div class="w-12 h-12 rounded-xl bg-brand/5 text-brand flex items-center justify-center group-hover:bg-brand group-hover:text-white transition-colors">
              <FolderKanban class="w-6 h-6" />
            </div>
            <Globe class="w-4 h-4 text-gray-400" />
          </div>
          <h3 class="text-lg font-semibold text-gray-900 truncate group-hover:text-brand transition-colors">{workspace.name}</h3>
          <p class="text-sm text-gray-500 mt-1 line-clamp-2 min-h-[2.5rem]">
            {workspace.description || "No description provided."}
          </p>
          <div class="mt-6 pt-4 border-t border-gray-100 flex items-center justify-between text-xs text-gray-400">
            <div class="flex items-center gap-3">
              <span class="font-mono">{workspace.giteaRepoName}</span>
              {#if workspace.forkCount > 0}
                <span class="flex items-center gap-1">
                  <GitFork class="w-3 h-3" />
                  {workspace.forkCount}
                </span>
              {/if}
            </div>
            <span>{new Date(workspace.createdAt).toLocaleDateString()}</span>
          </div>
        </a>
      {/each}
    </div>

    {#if totalPages > 1}
      <div class="flex items-center justify-center gap-2 mt-8">
        <button
          onclick={() => goToPage(page - 1)}
          disabled={page === 1}
          class="px-3 py-1.5 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Previous
        </button>
        <span class="text-sm text-gray-500">
          Page {page} of {totalPages} ({total} total)
        </span>
        <button
          onclick={() => goToPage(page + 1)}
          disabled={page === totalPages}
          class="px-3 py-1.5 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Next
        </button>
      </div>
    {/if}
  {/if}
</div>