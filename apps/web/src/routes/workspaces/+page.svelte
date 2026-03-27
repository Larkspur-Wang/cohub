<script lang="ts">
import { Plus, FolderKanban, Lock, Globe, GitFork } from "lucide-svelte";
import { normalizeWorkspaceSlug } from "@cohub/protocol";
import { createWorkspace, getMe, getWorkspaces, type Workspace } from "$lib/api";
import { fade } from "svelte/transition";
import { onMount } from "svelte";
import { goto } from "$app/navigation";

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

let previewSlug = $derived(normalizeWorkspaceSlug(formName));

async function loadData() {
  isLoading = true;
  loadError = "";
  try {
    const [me, ws] = await Promise.all([getMe().catch(() => null), getWorkspaces()]);
    user = me;
    workspaces = ws;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load workspaces";
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

async function handleSubmit(e: Event) {
  e.preventDefault();
  if (!formName.trim() || isSubmitting) return;

  const normalizedSlug = normalizeWorkspaceSlug(formName);
  if (!normalizedSlug) {
    alert("Workspace name must contain letters or numbers.");
    return;
  }

  isSubmitting = true;
  createStatusText = "Preparing workspace infrastructure...";
  try {
    await createWorkspace({
      name: formName.trim(),
      description: formDescription.trim(),
      private: formPrivate,
    });
    createStatusText = "Creating workspace repository...";
    isAdding = false;
    formName = "";
    formDescription = "";
    formPrivate = true;
    createStatusText = "";
    await loadData();
  } catch (error) {
    createStatusText = "";
    const message = error instanceof Error ? error.message : "Failed to prepare workspace infrastructure";
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

<div class="space-y-8">
  <div class="flex items-center justify-between">
    <div>
      <h1 class="text-3xl font-bold tracking-tight text-gray-900">Workspaces</h1>
      <p class="mt-2 text-sm text-gray-500">Manage your agent repositories and codebases.</p>
    </div>
    <button
      onclick={() => (isAdding = true)}
      class="px-4 py-2 bg-brand text-white text-sm font-medium rounded-xl hover:bg-brand/90 transition-colors shadow-sm flex items-center gap-2"
    >
      <Plus class="w-4 h-4" />
      New Workspace
    </button>
  </div>

  {#if isAdding}
    <div transition:fade class="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm mb-8">
      <div class="flex items-center justify-between mb-6">
        <h2 class="text-lg font-semibold text-gray-900">Create New Workspace</h2>
        <button onclick={() => (isAdding = false)} class="text-sm text-gray-500 hover:text-gray-900">Cancel</button>
      </div>

      <form onsubmit={handleSubmit} class="space-y-4 max-w-md">
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1" for="name">Workspace Name</label>
          <div class="flex items-center gap-2">
            <span class="text-gray-500 font-mono text-sm">{user?.nick_name || "owner"} /</span>
            <input
              type="text"
              id="name"
              bind:value={formName}
              placeholder="My Awesome Agent"
              class="w-full px-4 py-2 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-brand focus:border-brand outline-none font-mono text-sm"
              required
            />
          </div>
          <p class="mt-2 text-xs text-gray-500">
            Repository slug: <span class="font-mono text-gray-700">{previewSlug || "my-awesome-agent"}</span>
          </p>
        </div>

        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1" for="description">Description (Optional)</label>
          <input
            type="text"
            id="description"
            bind:value={formDescription}
            placeholder="A brief description of this workspace"
            class="w-full px-4 py-2 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-brand focus:border-brand outline-none"
          />
        </div>

        <div>
          <label class="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" bind:checked={formPrivate} class="rounded border-gray-300 text-brand focus:ring-brand" />
            <span class="text-sm font-medium text-gray-700">Private Repository</span>
          </label>
          <p class="text-xs text-gray-500 mt-1 ml-6">Only you can access this workspace.</p>
        </div>

        <button
          type="submit"
          disabled={isSubmitting}
          class="w-full py-2.5 bg-gray-900 text-white font-medium rounded-xl hover:bg-gray-800 transition-colors disabled:opacity-50 mt-4"
        >
          {isSubmitting ? (createStatusText || "Preparing workspace infrastructure...") : "Create Workspace"}
        </button>
      </form>
    </div>
  {/if}

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
        <FolderKanban class="w-8 h-8 text-gray-400" />
      </div>
      <h3 class="text-lg font-medium text-gray-900 mb-1">No workspaces yet</h3>
      <p class="text-sm text-gray-500 mb-4">Create a workspace to start hosting your agent's files.</p>
      <button onclick={() => (isAdding = true)} class="text-brand text-sm font-medium hover:underline">
        Create your first workspace
      </button>
    </div>
  {:else}
    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {#each workspaces as workspace}
        <a href="/workspaces/{workspace.id}" class="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 flex flex-col group hover:border-brand/30 transition-colors">
          <div class="flex items-start justify-between mb-4">
            <div class="w-12 h-12 rounded-xl bg-brand/5 text-brand flex items-center justify-center group-hover:bg-brand group-hover:text-white transition-colors">
              <FolderKanban class="w-6 h-6" />
            </div>
            {#if workspace.visibility === "private"}
              <Lock class="w-4 h-4 text-gray-400" />
            {:else}
              <Globe class="w-4 h-4 text-gray-400" />
            {/if}
          </div>
          <h3 class="text-lg font-semibold text-gray-900 truncate group-hover:text-brand transition-colors">{workspace.name}</h3>
          <p class="text-sm text-gray-500 mt-1 line-clamp-2 min-h-[2.5rem]">
            {workspace.description || "No description provided."}
          </p>
          <div class="mt-6 pt-4 border-t border-gray-100 flex items-center justify-between text-xs text-gray-400 font-mono">
            <span>{workspace.giteaRepoName}</span>
            <div class="flex items-center gap-3">
              {#if workspace.forkCount && workspace.forkCount > 0}
                <span class="flex items-center gap-1 text-gray-400">
                  <GitFork class="w-3 h-3" />
                  {workspace.forkCount}
                </span>
              {/if}
              <span>{new Date(workspace.createdAt).toLocaleDateString()}</span>
            </div>
          </div>
        </a>
      {/each}
    </div>
  {/if}
</div>
