<script lang="ts">
import {
  FolderKanban,
  Globe,
  Lock,
  Play,
  Terminal,
  Copy,
  Check,
  FileCode,
  Folder,
  GitFork,
} from "lucide-svelte";
import { getWorkspaceById, getWorkspaceTree, forkWorkspace, updateWorkspace, type Tree, type WorkspaceDetail } from "$lib/api";
import { onMount } from "svelte";
import { goto } from "$app/navigation";

let { params } = $props();

let workspaceId = $derived(params.id);

let workspace = $state<WorkspaceDetail | null>(null);
let tree = $state<Tree | null>(null);
let isEmpty = $state(false);
let isLoading = $state(true);
let isForking = $state(false);
let isPublishing = $state(false);
let loadError = $state("");
let copied = $state(false);

const gitRemoteUrl = $derived(workspace?.sshUrl || workspace?.cloneUrl || "");
const isOwner = $derived(Boolean(workspace?.isOwner));

async function loadWorkspace() {
  isLoading = true;
  loadError = "";
  try {
    workspace = await getWorkspaceById(workspaceId);
    tree = await getWorkspaceTree(workspaceId, "").catch(() => null);
    isEmpty = !tree || !tree.entries || tree.entries.length === 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Workspace not found or access denied";
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
  loadWorkspace();
});

function copyCloneUrl() {
  if (!gitRemoteUrl) return;
  navigator.clipboard.writeText(gitRemoteUrl);
  copied = true;
  setTimeout(() => {
    copied = false;
  }, 2000);
}

async function handleFork() {
  if (isForking || !workspace) return;
  isForking = true;
  try {
    const result = await forkWorkspace(workspace.id);
    goto(`/workspaces/${result.id}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fork workspace";
    alert(message);
  } finally {
    isForking = false;
  }
}

async function handlePublish() {
  if (isPublishing || !workspace) return;
  if (workspace.visibility === "public") return;
  
  isPublishing = true;
  try {
    const result = await updateWorkspace(workspace.id, { visibility: "public" });
    workspace = result;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to publish workspace";
    alert(message);
  } finally {
    isPublishing = false;
  }
}
</script>

<div class="neo-page-shell">
  {#if isLoading}
    <div class="neo-loading">Loading workspace...</div>
  {:else if loadError}
    <div class="neo-error">
      <h2 class="neo-section-title text-white">Error</h2>
      <p class="mt-2 text-sm font-bold break-all">{loadError}</p>
    </div>
  {:else if workspace}
    <div class="neo-card p-5 md:p-6 neo-fill-white">
      <div class="flex flex-col xl:flex-row xl:items-start xl:justify-between gap-5">
        <div class="flex items-start gap-4 min-w-0">
          <div class="neo-icon-box neo-fill-blue shrink-0">
            <FolderKanban class="w-5 h-5" />
          </div>
          <div class="min-w-0">
            <div class="flex items-center gap-2 flex-wrap">
              <h1 class="text-3xl md:text-4xl font-black tracking-tighter uppercase min-w-0 break-words">{workspace.name}</h1>
              {#if workspace.visibility === "private"}
                <span class="neo-badge neo-badge-yellow"><Lock class="w-3 h-3" /> Private</span>
              {:else}
                <span class="neo-badge neo-badge-green"><Globe class="w-3 h-3" /> Public</span>
              {/if}
            </div>
            <div class="mt-3 flex flex-wrap items-center gap-2 text-sm font-bold text-black/60">
              <span>Owned by <span class="text-black">{workspace.ownerUsername || workspace.ownerUserUuid}</span></span>
              {#if workspace.forkedFrom}
                <span>•</span>
                <a href="/workspaces/{workspace.forkedFrom.id}" class="inline-flex items-center gap-1 text-black underline decoration-[3px] underline-offset-4">
                  <GitFork class="w-4 h-4" />
                  forked from {workspace.forkedFrom.ownerUsername || workspace.forkedFrom.ownerUserUuid}/{workspace.forkedFrom.name}
                </a>
              {/if}
            </div>
            {#if workspace.description}
              <p class="mt-3 neo-page-desc max-w-3xl">{workspace.description}</p>
            {/if}
          </div>
        </div>

        <div class="flex items-center gap-3 flex-wrap shrink-0">
          {#if !isOwner && workspace.visibility === "public"}
            <button onclick={handleFork} disabled={isForking} class="neo-btn neo-btn-secondary disabled:opacity-50">
              <GitFork class="w-4 h-4" />
              {isForking ? "Forking..." : "Fork Workspace"}
            </button>
          {/if}
          {#if isOwner && workspace.visibility === "private"}
            <button onclick={handlePublish} disabled={isPublishing} class="neo-btn neo-btn-secondary disabled:opacity-50">
              <Globe class="w-4 h-4" />
              {isPublishing ? "Publishing..." : "Make Public"}
            </button>
          {/if}
          {#if isOwner && !isEmpty}
            <a href="/workspaces/{workspace.id}/runtimes/new" class="neo-btn neo-btn-primary">
              <Play class="w-4 h-4" />
              Create Runtime
            </a>
          {/if}
        </div>
      </div>
    </div>

    {#if !isOwner && workspace.visibility === "public"}
      <div class="neo-card-sm neo-fill-yellow p-4 text-sm font-bold text-black">
        Sign in to fork this workspace and run your own copy.
      </div>
    {/if}

    {#if isEmpty}
      <div class="neo-card overflow-hidden bg-white">
        <div class="px-5 py-4 border-b-[4px] border-black neo-fill-blue flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div>
            <h2 class="neo-section-title">Repository Setup</h2>
            <p class="mt-2 text-sm font-bold text-black/70">This workspace is empty. Initialize it with Git.</p>
          </div>
          {#if gitRemoteUrl}
            <button onclick={copyCloneUrl} class="neo-btn neo-btn-secondary !px-4 !py-2 text-xs">
              {#if copied}
                <Check class="w-4 h-4" /> Copied
              {:else}
                <Copy class="w-4 h-4" /> Copy Remote
              {/if}
            </button>
          {/if}
        </div>

        {#if gitRemoteUrl}
          <div class="p-5 grid grid-cols-1 xl:grid-cols-2 gap-4 bg-white">
            <div class="neo-card-sm neo-fill-paper p-4">
              <div class="flex items-center gap-2 mb-3">
                <Terminal class="w-4 h-4" />
                <span class="neo-meta">Create a new repository</span>
              </div>
              <pre class="font-mono text-xs leading-6 whitespace-pre-wrap break-words text-black/80">touch README.md

git init
git checkout -b main
git add README.md
git commit -m "first commit"
git remote add origin {gitRemoteUrl}
git push -u origin main</pre>
            </div>
            <div class="neo-card-sm neo-fill-paper p-4">
              <div class="flex items-center gap-2 mb-3">
                <Terminal class="w-4 h-4" />
                <span class="neo-meta">Push existing repository</span>
              </div>
              <pre class="font-mono text-xs leading-6 whitespace-pre-wrap break-words text-black/80">git remote add origin {gitRemoteUrl}
git push -u origin main</pre>
            </div>
          </div>
        {/if}
      </div>
    {:else if tree}
      <div class="neo-card overflow-hidden bg-white">
        <div class="px-5 py-4 border-b-[4px] border-black neo-fill-yellow flex items-center justify-between gap-3">
          <h2 class="neo-section-title">Repository Files</h2>
          <span class="neo-badge neo-badge-white">{tree.entries.length} entries</span>
        </div>
        <div class="p-4 space-y-3">
          {#each tree.entries as entry}
            <div class="neo-card-sm neo-fill-paper px-4 py-3 flex items-center gap-3">
              {#if entry.type === "dir"}
                <div class="neo-icon-box neo-fill-blue !w-10 !h-10 !rounded-xl !shadow-[2px_2px_0_0_#000]"><Folder class="w-4 h-4" /></div>
                <div class="min-w-0 flex-1">
                  <div class="font-black uppercase tracking-tight truncate">{entry.name}</div>
                  <div class="text-xs font-bold text-black/50">Directory</div>
                </div>
              {:else}
                <div class="neo-icon-box neo-fill-white !w-10 !h-10 !rounded-xl !shadow-[2px_2px_0_0_#000]"><FileCode class="w-4 h-4" /></div>
                <div class="min-w-0 flex-1">
                  <div class="font-black uppercase tracking-tight truncate">{entry.name}</div>
                  <div class="text-xs font-bold text-black/50">File</div>
                </div>
              {/if}
            </div>
          {/each}
        </div>
      </div>
    {/if}
  {/if}
</div>
