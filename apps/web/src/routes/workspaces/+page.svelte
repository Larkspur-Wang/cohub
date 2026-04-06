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
  <div class="h-[40px] flex items-center justify-between px-4 border-b border-border-subtle shrink-0 bg-bg-primary">
    <div class="flex items-center gap-1">
      <button
        type="button"
        class={`px-2.5 py-1 rounded-[5px] text-[12px] font-medium transition-colors duration-100 ${viewMode === "my" ? "bg-bg-active text-text-primary" : "text-text-tertiary hover:text-text-secondary hover:bg-bg-hover"}`}
        onclick={() => viewMode = "my"}
      >
        My Workspaces
      </button>
      <button
        type="button"
        class={`px-2.5 py-1 rounded-[5px] text-[12px] font-medium transition-colors duration-100 ${viewMode === "explore" ? "bg-bg-active text-text-primary" : "text-text-tertiary hover:text-text-secondary hover:bg-bg-hover"}`}
        onclick={() => viewMode = "explore"}
      >
        Explore
      </button>
    </div>

    {#if viewMode === "my"}
      <button
        type="button"
        class="flex items-center gap-1.5 px-2.5 py-1 rounded-[5px] text-[12px] text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors duration-100"
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
      <div class="mb-4 border border-border-subtle rounded-md bg-bg-surface p-4" in:fade>
        <div class="flex items-center justify-between mb-4">
          <h2 class="text-[13px] font-medium text-text-primary">Create Workspace</h2>
          <button onclick={() => isAdding = false} class="text-text-tertiary hover:text-text-secondary transition-colors">
            <X class="w-4 h-4" />
          </button>
        </div>

        <form onsubmit={handleSubmit} class="space-y-3">
          <div>
            <label class="block text-[10px] font-medium uppercase tracking-wider text-text-tertiary mb-1.5" for="ws-name">Name</label>
            <div class="flex items-center gap-2">
              <span class="text-[11px] text-text-tertiary font-mono shrink-0">{user?.nick_name || "owner"}/</span>
              <input
                id="ws-name"
                type="text"
                bind:value={formName}
                placeholder="my-workspace"
                class="flex-1 px-3 py-[6px] rounded-[5px] bg-bg-input border border-border-subtle text-[13px] text-text-primary placeholder:text-text-placeholder focus:border-brand/40 focus:outline-none font-mono transition-colors"
                required
              />
            </div>
            {#if formName}
              <p class="mt-1 text-[11px] text-text-placeholder font-mono">repo: {previewSlug || "my-workspace"}</p>
            {/if}
          </div>

          <div>
            <label class="block text-[10px] font-medium uppercase tracking-wider text-text-tertiary mb-1.5" for="ws-desc">Description</label>
            <input
              id="ws-desc"
              type="text"
              bind:value={formDescription}
              placeholder="A brief description"
              class="w-full px-3 py-[6px] rounded-[5px] bg-bg-input border border-border-subtle text-[13px] text-text-primary placeholder:text-text-placeholder focus:border-brand/40 focus:outline-none transition-colors"
            />
          </div>

          <label class="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" bind:checked={formPrivate} class="rounded-sm bg-bg-input border-border-subtle checked:bg-brand" />
            <span class="text-[13px] text-text-secondary">Private workspace</span>
          </label>

          {#if createError}
            <div class="rounded-md border border-error-soft/30 bg-error-bg p-2 text-[12px] text-error-soft">{createError}</div>
          {/if}

          <button
            type="submit"
            disabled={isSubmitting}
            class="px-4 py-[6px] rounded-[5px] bg-[#FF3E00] hover:bg-brand-hover text-[13px] text-white font-medium transition-colors disabled:opacity-50"
          >
            {isSubmitting ? "Creating..." : "Create"}
          </button>
        </form>
      </div>
    {/if}

    <!-- My Workspaces -->
    {#if viewMode === "my"}
      {#if isLoading}
        <div class="flex items-center justify-center py-12 text-[12px] text-text-tertiary">
          <div class="w-4 h-4 rounded-full border-2 border-border-subtle border-t-brand animate-spin mr-2"></div>
          Loading workspaces...
        </div>
      {:else if loadError}
        <div class="rounded-md border border-error-soft/30 bg-error-bg p-3 text-[12px] font-mono text-error-soft break-all">{loadError}</div>
      {:else if workspaces.length === 0}
        <div class="flex flex-col items-center justify-center py-16 text-center">
          <div class="w-11 h-11 rounded-md bg-bg-surface border border-border-subtle flex items-center justify-center mb-3">
            <FolderKanban class="w-5 h-5 text-text-placeholder" />
          </div>
          <p class="text-[14px] text-text-tertiary">No workspaces yet</p>
          <p class="text-[12px] text-text-placeholder mt-1">Create a workspace to get started</p>
          <button onclick={() => isAdding = true} class="mt-4 px-3 py-1.5 rounded-[5px] bg-bg-surface hover:bg-bg-surface-hover border border-border-subtle text-[13px] text-text-secondary hover:text-text-primary transition-colors">
            Create your first workspace
          </button>
        </div>
      {:else}
        <!-- List layout for density -->
        <div class="rounded-md border border-border-subtle overflow-hidden">
          <div class="grid grid-cols-[auto_1fr_auto_auto] gap-3 px-3 py-2 bg-bg-header-alt text-[10px] font-medium uppercase tracking-[0.08em] text-text-placeholder border-b border-border-subtle">
            <span></span>
            <span>Name</span>
            <span>Status</span>
            <span class="text-right">Forks</span>
          </div>
          {#each workspaces as workspace}
            <a
              href="/workspaces/{workspace.id}"
              class="group grid grid-cols-[auto_1fr_auto_auto] gap-3 px-3 py-2.5 border-b border-border-subtle last:border-b-0 hover:bg-bg-hover transition-colors duration-100"
            >
              <div class="w-7 h-7 rounded-[5px] bg-blue-500/10 border border-blue-500/20 flex items-center justify-center shrink-0 mt-0.5">
                <FolderKanban class="w-3.5 h-3.5 text-blue-400/70" />
              </div>
              <div class="min-w-0">
                <div class="text-[13px] font-medium text-text-primary truncate">{workspace.name}</div>
                {#if workspace.description}
                  <div class="text-[11px] text-text-tertiary truncate mt-0.5">{workspace.description}</div>
                {:else}
                  <div class="text-[11px] font-mono text-text-placeholder truncate mt-0.5">{workspace.giteaRepoName}</div>
                {/if}
              </div>
              <div class="shrink-0 flex items-center gap-1.5 pt-0.5">
                {#if workspace.visibility === "private"}
                  <span class="flex items-center gap-1 px-1.5 py-0.5 rounded-sm text-[10px] bg-warning-bg text-warning-soft border border-warning-soft/30">
                    <Lock class="w-2.5 h-2.5" />
                    Private
                  </span>
                {:else}
                  <span class="flex items-center gap-1 px-1.5 py-0.5 rounded-sm text-[10px] bg-success-bg text-success-soft border border-success-soft/30">
                    <Globe class="w-2.5 h-2.5" />
                    Public
                  </span>
                {/if}
              </div>
              <div class="text-[11px] text-text-placeholder text-right font-mono pt-0.5 shrink-0">
                {#if workspace.forkCount && workspace.forkCount > 0}
                  <span class="flex items-center gap-1 justify-end"><GitFork class="w-3 h-3" /> {workspace.forkCount}</span>
                {:else}
                  —
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
            class="w-full pl-8 pr-3 py-[6px] rounded-[5px] bg-bg-input border border-border-subtle text-[13px] text-text-primary placeholder:text-text-placeholder focus:border-brand/40 focus:outline-none transition-colors"
          />
        </div>
        <button type="submit" class="px-3 py-[6px] rounded-[5px] bg-bg-surface hover:bg-bg-surface-hover border border-border-subtle text-[13px] text-text-secondary hover:text-text-primary transition-colors">
          Search
        </button>
      </form>

      {#if exploreLoading}
        <div class="flex items-center justify-center py-12 text-[12px] text-text-tertiary">
          <div class="w-4 h-4 rounded-full border-2 border-border-subtle border-t-brand animate-spin mr-2"></div>
          Loading...
        </div>
      {:else if exploreError}
        <div class="rounded-md border border-error-soft/30 bg-error-bg p-3 text-[12px] font-mono text-error-soft break-all">{exploreError}</div>
      {:else if publicWorkspaces.length === 0}
        <div class="flex flex-col items-center justify-center py-16 text-center">
          <div class="w-11 h-11 rounded-md bg-bg-surface border border-border-subtle flex items-center justify-center mb-3">
            <Globe class="w-5 h-5 text-text-placeholder" />
          </div>
          <p class="text-[14px] text-text-tertiary">No public workspaces found</p>
          <p class="text-[12px] text-text-placeholder mt-1">{exploreSearch ? "Try a different search term" : "Be the first to make a workspace public"}</p>
        </div>
      {:else}
        <div class="rounded-md border border-border-subtle overflow-hidden">
          {#each publicWorkspaces as workspace}
            <a
              href="/workspaces/{workspace.id}"
              class="group grid grid-cols-[auto_1fr_auto_auto] gap-3 px-3 py-2.5 border-b border-border-subtle last:border-b-0 hover:bg-bg-hover transition-colors duration-100"
            >
              <div class="w-7 h-7 rounded-[5px] bg-success-bg border border-success-soft/30 flex items-center justify-center shrink-0 mt-0.5">
                <Globe class="w-3.5 h-3.5 text-success-soft" />
              </div>
              <div class="min-w-0">
                <div class="text-[13px] font-medium text-text-primary truncate">{workspace.name}</div>
                {#if workspace.description}
                  <div class="text-[11px] text-text-tertiary truncate mt-0.5">{workspace.description}</div>
                {:else}
                  <div class="text-[11px] font-mono text-text-placeholder truncate mt-0.5">{workspace.giteaRepoName}</div>
                {/if}
              </div>
              <div class="shrink-0 flex items-center pt-0.5">
                <span class="px-1.5 py-0.5 rounded-sm text-[10px] bg-success-bg text-success-soft border border-success-soft/30">Public</span>
              </div>
              <div class="text-[11px] text-text-placeholder text-right font-mono pt-0.5 shrink-0">
                {#if workspace.forkCount > 0}
                  <span class="flex items-center gap-1 justify-end"><GitFork class="w-3 h-3" /> {workspace.forkCount}</span>
                {:else}
                  —
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
              class="px-3 py-1.5 rounded-[5px] bg-bg-surface hover:bg-bg-surface-hover border border-border-subtle text-[12px] text-text-tertiary hover:text-text-secondary transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            >
              Previous
            </button>
            <span class="text-[11px] text-text-tertiary">Page {explorePage} / {exploreTotalPages}</span>
            <button
              onclick={() => goToExplorePage(explorePage + 1)}
              disabled={explorePage === exploreTotalPages}
              class="px-3 py-1.5 rounded-[5px] bg-bg-surface hover:bg-bg-surface-hover border border-border-subtle text-[12px] text-text-tertiary hover:text-text-secondary transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            >
              Next
            </button>
          </div>
        {/if}
      {/if}
    {/if}
  </div>
</div>
