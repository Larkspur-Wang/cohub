<script lang="ts">
import { Plus, FolderKanban, Lock, Globe, GitFork, X } from "lucide-svelte";
import { normalizeWorkspaceSlug } from "@cohub/protocol";
import { createWorkspace, getMe, getWorkspaces, type Workspace } from "$lib/api";
import { fade, fly } from "svelte/transition";
import { onMount } from "svelte";
import { ensureAuth, logtoClient } from "$lib/auth";

let workspaces = $state<Workspace[]>([]);
let isLoading = $state(true);
let loadError = $state("");

let isAdding = $state(false);
let isSubmitting = $state(false);
let createStatusText = $state("");

let formName = $state("");
let formDescription = $state("");
let formPrivate = $state(true);
let user = $state<{ uuid?: string; nick_name?: string } | null>(null);

const previewSlug = $derived(normalizeWorkspaceSlug(formName));

async function loadData() {
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

onMount(() => {
  loadData();
});

async function handleSubmit(e: Event) {
  e.preventDefault();
  if (!formName.trim() || isSubmitting) return;

  const normalizedSlug = normalizeWorkspaceSlug(formName);
  if (!normalizedSlug) {
    alert("Workspace name must contain letters or numbers.");
    return;
  }

  isSubmitting = true;
  createStatusText = "Preparing workspace...";
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
    createStatusText = "";
    await loadData();
  } catch (error) {
    createStatusText = "";
    const message = error instanceof Error ? error.message : "Failed to create workspace";
    if (message.includes("workspace slug already exists") || message.includes("409")) {
      alert("A workspace with the same repository slug already exists.");
      return;
    }
    if (message.includes("workspace name must contain letters or numbers")) {
      alert("Workspace name must contain letters or numbers.");
      return;
    }
    alert(message);
  } finally {
    isSubmitting = false;
  }
}
</script>

<div class="neo-page-shell">
  <div class="neo-page-header" in:fly={{ y: 20, duration: 300 }}>
    <div>
      <h1 class="neo-page-title text-black">Workspaces</h1>
      <p class="neo-page-desc mt-3 max-w-2xl">Manage code, prompts, and assets for every agent workspace in one place.</p>
    </div>
    <button onclick={() => (isAdding = true)} class="neo-btn neo-btn-primary">
      <Plus class="w-4 h-4" />
      New Workspace
    </button>
  </div>

  {#if isAdding}
    <div class="neo-card p-5 md:p-6 bg-white" transition:fade>
      <div class="flex items-center justify-between gap-4 mb-5">
        <div>
          <h2 class="neo-section-title">Create Workspace</h2>
          <p class="neo-page-desc mt-2 text-sm">Create a new hosted repository for your agent project.</p>
        </div>
        <button onclick={() => (isAdding = false)} class="neo-btn neo-btn-secondary !px-3 !py-2">
          <X class="w-4 h-4" />
          Close
        </button>
      </div>

      <form onsubmit={handleSubmit} class="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_260px] gap-5">
        <div class="space-y-4">
          <div>
            <label class="neo-meta mb-2 block" for="name">Workspace Name</label>
            <div class="flex items-center gap-2">
              <span class="neo-badge neo-badge-yellow shrink-0">{user?.nick_name || "owner"}</span>
              <input
                type="text"
                id="name"
                bind:value={formName}
                placeholder="My Awesome Agent"
                class="neo-input"
                required
              />
            </div>
            <p class="mt-2 text-xs font-bold text-black/60">
              Repository slug: <span class="font-mono text-black">{previewSlug || "my-awesome-agent"}</span>
            </p>
          </div>

          <div>
            <label class="neo-meta mb-2 block" for="description">Description</label>
            <input
              type="text"
              id="description"
              bind:value={formDescription}
              placeholder="A brief description of this workspace"
              class="neo-input"
            />
          </div>
        </div>

        <div class="neo-card-sm neo-fill-paper p-4 space-y-4 self-start">
          <div>
            <div class="neo-meta mb-2">Visibility</div>
            <label class="flex items-center gap-3 cursor-pointer rounded-2xl border-[3px] border-black bg-white px-4 py-3">
              <input type="checkbox" bind:checked={formPrivate} class="h-4 w-4 accent-black" />
              <div>
                <div class="font-black uppercase tracking-tight text-sm">Private Workspace</div>
                <div class="text-xs font-bold text-black/60 mt-1">Only you can access this repository.</div>
              </div>
            </label>
          </div>

          <button type="submit" disabled={isSubmitting} class="neo-btn neo-btn-primary w-full disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-x-0 disabled:hover:translate-y-0 disabled:hover:shadow-[4px_4px_0_0_#000]">
            {isSubmitting ? (createStatusText || "Creating...") : "Create Workspace"}
          </button>
        </div>
      </form>
    </div>
  {/if}

  {#if isLoading}
    <div class="neo-loading">Loading workspaces...</div>
  {:else if loadError}
    <div class="neo-error">
      <h2 class="neo-section-title text-white">Load Failed</h2>
      <p class="mt-2 text-sm font-bold break-all">{loadError}</p>
    </div>
  {:else if workspaces.length === 0}
    <div class="neo-empty">
      <div class="neo-icon-box neo-fill-yellow mx-auto mb-4">
        <FolderKanban class="w-5 h-5" />
      </div>
      <h3 class="neo-section-title">No Workspaces Yet</h3>
      <p class="neo-page-desc mt-3 text-sm">Create a workspace to start hosting your agent files.</p>
      <div class="mt-5">
        <button onclick={() => (isAdding = true)} class="neo-btn neo-btn-primary">Create First Workspace</button>
      </div>
    </div>
  {:else}
    <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
      {#each workspaces as workspace}
        <a href="/workspaces/{workspace.id}" class="neo-list-card p-4 bg-white flex flex-col gap-4">
          <div class="flex items-start justify-between gap-3">
            <div class="neo-icon-box neo-fill-blue">
              <FolderKanban class="w-5 h-5" />
            </div>
            {#if workspace.visibility === "private"}
              <span class="neo-badge neo-badge-yellow"><Lock class="w-3 h-3" /> Private</span>
            {:else}
              <span class="neo-badge neo-badge-green"><Globe class="w-3 h-3" /> Public</span>
            {/if}
          </div>

          <div>
            <h3 class="text-lg font-black uppercase tracking-tight line-clamp-1">{workspace.name}</h3>
            <p class="mt-2 text-sm font-bold text-black/60 line-clamp-2 min-h-[2.5rem]">{workspace.description || "No description provided."}</p>
          </div>

          <div class="mt-auto flex items-center justify-between gap-3 border-t-[3px] border-black pt-3 text-[11px] font-bold text-black/55">
            <span class="font-mono truncate">{workspace.giteaRepoName}</span>
            <div class="flex items-center gap-3 shrink-0">
              {#if workspace.forkCount && workspace.forkCount > 0}
                <span class="inline-flex items-center gap-1"><GitFork class="w-3 h-3" /> {workspace.forkCount}</span>
              {/if}
              <span>{new Date(workspace.createdAt).toLocaleDateString()}</span>
            </div>
          </div>
        </a>
      {/each}
    </div>
  {/if}
</div>
