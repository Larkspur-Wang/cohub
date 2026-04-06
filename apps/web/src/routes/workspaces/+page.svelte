<script lang="ts">
import { Plus, FolderKanban, Lock, Globe, GitFork, X, Search } from "lucide-svelte";
import { normalizeWorkspaceSlug } from "@cohub/protocol";
import { createWorkspace, getMe, getWorkspaces, type Workspace, getPublicWorkspaces, type PublicWorkspace } from "$lib/api";
import { fade, fly } from "svelte/transition";
import { onMount } from "svelte";
import { ensureAuth, logtoClient } from "$lib/auth";

let workspaces = $state<Workspace[]>([]);
let publicWorkspaces = $state<PublicWorkspace[]>([]);
let isLoading = $state(true);
let loadError = $state("");
let viewMode = $state<"my" | "explore">("my");

// Explore state
let exploreSearch = $state("");
let explorePage = $state(1);
let exploreTotalPages = $state(1);
let exploreLoading = $state(false);
let exploreError = $state("");

// Create form
let isAdding = $state(false);
let isSubmitting = $state(false);
let createError = $state("");
let formName = $state("");
let formDescription = $state("");
let formPrivate = $state(true);
let user = $state<{ uuid?: string; nick_name?: string } | null>(null);

const previewSlug = $derived(normalizeWorkspaceSlug(formName));

async function loadMyWorkspaces() {
  if (!(await ensureAuth())) return;
  isLoading = true;
  loadError = "";
  try {
    const [me, ws] = await Promise.all([getMe().catch(() => null), getWorkspaces()]);
    user = me;
    workspaces = ws;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load workspaces";
    if (message.includes("unauthorized") || message.includes("401")) {
      await logtoClient.signIn(`${window.location.origin}/callback`);
      return;
    }
    loadError = message;
  } finally {
    isLoading = false;
  }
}

async function loadExplore() {
  exploreLoading = true;
  exploreError = "";
  try {
    const response = await getPublicWorkspaces(explorePage, 20, exploreSearch || undefined);
    publicWorkspaces = response.items;
    exploreTotalPages = response.pagination.totalPages;
  } catch (error) {
    exploreError = error instanceof Error ? error.message : "Failed to load public workspaces";
  } finally {
    exploreLoading = false;
  }
}

onMount(() => {
  void loadMyWorkspaces();
  void loadExplore();
});

function handleExploreSearch(e: Event) {
  e.preventDefault();
  explorePage = 1;
  void loadExplore();
}

function goToExplorePage(newPage: number) {
  if (newPage < 1 || newPage > exploreTotalPages) return;
  explorePage = newPage;
  void loadExplore();
}

async function handleSubmit(e: Event) {
  e.preventDefault();
  if (!formName.trim() || isSubmitting) return;

  const normalizedSlug = normalizeWorkspaceSlug(formName);
  if (!normalizedSlug) {
    createError = "Workspace name must contain letters or numbers.";
    return;
  }

  isSubmitting = true;
  createError = "";
  try {
    await createWorkspace({
      name: formName.trim(),
      description: formDescription.trim(),
      private: formPrivate,
    });
    isAdding = false;
    formName = "";
    formDescription = "";
    formPrivate = true;
    await loadMyWorkspaces();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create workspace";
    if (message.includes("workspace slug already exists") || message.includes("409")) {
      createError = "A workspace with the same repository slug already exists.";
      return;
    }
    if (message.includes("workspace name must contain letters or numbers")) {
      createError = "Workspace name must contain letters or numbers.";
      return;
    }
    createError = message;
  } finally {
    isSubmitting = false;
  }
}
</script>

<div class="flex-1 flex flex-col min-h-0 overflow-y-auto">
  <!-- Header -->
  <div class="h-10 flex items-center justify-between px-4 border-b border-border-primary shrink-0 bg-bg-primary">
    <div class="flex items-center gap-1">
      <button
        type="button"
        class={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${viewMode === "my" ? "bg-hover-strong text-text-primary" : "text-text-tertiary hover:text-text-secondary hover:bg-hover"}`}
        onclick={() => viewMode = "my"}
      >
        My Workspaces
      </button>
      <button
        type="button"
        class={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${viewMode === "explore" ? "bg-hover-strong text-text-primary" : "text-text-tertiary hover:text-text-secondary hover:bg-hover"}`}
        onclick={() => viewMode = "explore"}
      >
        Explore
      </button>
    </div>

    {#if viewMode === "my"}
      <button
        type="button"
        class="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs text-text-secondary hover:text-text-primary hover:bg-hover transition-colors"
        onclick={() => isAdding = true}
      >
        <Plus class="w-3.5 h-3.5" />
        New Workspace
      </button>
    {/if}
  </div>

  <div class="flex-1 p-4 overflow-y-auto">
    <!-- Create Form -->
    {#if isAdding && viewMode === "my"}
      <div class="mb-4 border border-border-primary rounded-lg bg-bg-surface p-4" in:fade>
        <div class="flex items-center justify-between mb-4">
          <h2 class="text-sm font-medium text-text-primary">Create Workspace</h2>
          <button onclick={() => isAdding = false} class="text-text-tertiary hover:text-text-secondary transition-colors">
            <X class="w-4 h-4" />
          </button>
        </div>

        <form onsubmit={handleSubmit} class="space-y-3">
          <div>
            <label class="block text-[10px] font-medium uppercase tracking-wider text-text-tertiary mb-1.5" for="ws-name">Name</label>
            <div class="flex items-center gap-2">
              <span class="text-[10px] text-text-tertiary font-mono shrink-0">{user?.nick_name || "owner"}/</span>
              <input
                id="ws-name"
                type="text"
                bind:value={formName}
                placeholder="my-workspace"
                class="flex-1 px-3 py-1.5 rounded-md bg-bg-input border border-border-primary text-xs text-text-primary placeholder:text-text-placeholder focus:border-border-primary/30 focus:outline-none font-mono"
                required
              />
            </div>
            {#if formName}
              <p class="mt-1 text-[10px] text-text-placeholder font-mono">repo: {previewSlug || "my-workspace"}</p>
            {/if}
          </div>

          <div>
            <label class="block text-[10px] font-medium uppercase tracking-wider text-text-tertiary mb-1.5" for="ws-desc">Description</label>
            <input
              id="ws-desc"
              type="text"
              bind:value={formDescription}
              placeholder="A brief description"
              class="w-full px-3 py-1.5 rounded-md bg-bg-input border border-border-primary text-xs text-text-primary placeholder:text-text-placeholder focus:border-border-primary/30 focus:outline-none"
            />
          </div>

          <label class="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" bind:checked={formPrivate} class="rounded-sm bg-bg-input border-border-primary checked:bg-emerald-500" />
            <span class="text-xs text-text-secondary">Private workspace</span>
          </label>

          {#if createError}
            <div class="rounded-md border border-rose-500/20 bg-rose-500/10 p-2 text-xs text-rose-400">{createError}</div>
          {/if}

          <button
            type="submit"
            disabled={isSubmitting}
            class="px-4 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-500 text-xs text-white font-medium transition-colors disabled:opacity-50"
          >
            {isSubmitting ? "Creating..." : "Create"}
          </button>
        </form>
      </div>
    {/if}

    <!-- My Workspaces -->
    {#if viewMode === "my"}
      {#if isLoading}
        <div class="flex items-center justify-center py-12 text-xs text-text-tertiary">
          <div class="w-4 h-4 rounded-full border-2 border-border-primary border-t-emerald-400 animate-spin mr-2"></div>
          Loading workspaces...
        </div>
      {:else if loadError}
        <div class="rounded-md border border-rose-500/20 bg-rose-500/10 p-3 text-xs font-mono text-rose-400 break-all">{loadError}</div>
      {:else if workspaces.length === 0}
        <div class="flex flex-col items-center justify-center py-12 text-center">
          <div class="w-10 h-10 rounded-full bg-hover border border-border-primary flex items-center justify-center mb-3">
            <FolderKanban class="w-4 h-4 text-text-placeholder" />
          </div>
          <p class="text-sm text-text-tertiary">No workspaces yet</p>
          <p class="text-xs text-text-placeholder mt-1">Create a workspace to get started</p>
          <button onclick={() => isAdding = true} class="mt-4 px-3 py-1.5 rounded-md bg-hover hover:bg-hover-strong border border-border-primary text-xs text-text-secondary hover:text-text-primary transition-colors">
            Create your first workspace
          </button>
        </div>
      {:else}
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {#each workspaces as workspace}
            <a
              href="/workspaces/{workspace.id}"
              class="group block p-3 rounded-lg border border-border-primary bg-bg-surface hover:border-border-primary/20 hover:bg-bg-surface-hover transition-colors"
            >
              <div class="flex items-start justify-between gap-2 mb-2">
                <div class="w-8 h-8 rounded-md bg-blue-500/10 border border-blue-500/20 flex items-center justify-center shrink-0">
                  <FolderKanban class="w-4 h-4 text-blue-400/70" />
                </div>
                {#if workspace.visibility === "private"}
                  <span class="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-yellow-500/10 text-yellow-400/70 border border-yellow-500/20">
                    <Lock class="w-2.5 h-2.5" />
                  </span>
                {:else}
                  <span class="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-emerald-500/10 text-emerald-400/70 border border-emerald-500/20">
                    <Globe class="w-2.5 h-2.5" />
                  </span>
                {/if}
              </div>

              <h3 class="text-sm font-medium text-text-primary truncate">{workspace.name}</h3>
              <p class="mt-1 text-xs text-text-tertiary line-clamp-2 min-h-[2rem]">{workspace.description || "No description"}</p>

              <div class="mt-3 pt-2 border-t border-border-subtle flex items-center justify-between text-[10px] text-text-placeholder font-mono">
                <span class="truncate">{workspace.giteaRepoName}</span>
                {#if workspace.forkCount && workspace.forkCount > 0}
                  <span class="flex items-center gap-1 shrink-0"><GitFork class="w-2.5 h-2.5" /> {workspace.forkCount}</span>
                {/if}
              </div>
            </a>
          {/each}
        </div>
      {/if}
    {/if}

    <!-- Explore -->
    {#if viewMode === "explore"}
      <form onsubmit={handleExploreSearch} class="mb-4 flex gap-2">
        <div class="relative flex-1">
          <Search class="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-placeholder" />
          <input
            type="text"
            bind:value={exploreSearch}
            placeholder="Search public workspaces..."
            class="w-full pl-8 pr-3 py-1.5 rounded-md bg-bg-input border border-border-primary text-xs text-text-primary placeholder:text-text-placeholder focus:border-border-primary/30 focus:outline-none"
          />
        </div>
        <button type="submit" class="px-3 py-1.5 rounded-md bg-hover hover:bg-hover-strong border border-border-primary text-xs text-text-secondary hover:text-text-primary transition-colors">
          Search
        </button>
      </form>

      {#if exploreLoading}
        <div class="flex items-center justify-center py-12 text-xs text-text-tertiary">
          <div class="w-4 h-4 rounded-full border-2 border-border-primary border-t-emerald-400 animate-spin mr-2"></div>
          Loading...
        </div>
      {:else if exploreError}
        <div class="rounded-md border border-rose-500/20 bg-rose-500/10 p-3 text-xs font-mono text-rose-400 break-all">{exploreError}</div>
      {:else if publicWorkspaces.length === 0}
        <div class="flex flex-col items-center justify-center py-12 text-center">
          <div class="w-10 h-10 rounded-full bg-hover border border-border-primary flex items-center justify-center mb-3">
            <Globe class="w-4 h-4 text-text-placeholder" />
          </div>
          <p class="text-sm text-text-tertiary">No public workspaces found</p>
          <p class="text-xs text-text-placeholder mt-1">{exploreSearch ? "Try a different search term" : "Be the first to make a workspace public"}</p>
        </div>
      {:else}
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {#each publicWorkspaces as workspace}
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

        {#if exploreTotalPages > 1}
          <div class="flex items-center justify-center gap-3 mt-4">
            <button
              onclick={() => goToExplorePage(explorePage - 1)}
              disabled={explorePage === 1}
              class="px-3 py-1.5 rounded-md bg-hover hover:bg-hover-strong border border-border-primary text-xs text-text-tertiary hover:text-text-secondary transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            >
              Previous
            </button>
            <span class="text-[10px] text-text-tertiary">Page {explorePage} / {exploreTotalPages}</span>
            <button
              onclick={() => goToExplorePage(explorePage + 1)}
              disabled={explorePage === exploreTotalPages}
              class="px-3 py-1.5 rounded-md bg-hover hover:bg-hover-strong border border-border-primary text-xs text-text-tertiary hover:text-text-secondary transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            >
              Next
            </button>
          </div>
        {/if}
      {/if}
    {/if}
  </div>
</div>
