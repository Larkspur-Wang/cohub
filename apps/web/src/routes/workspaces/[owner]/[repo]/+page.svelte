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
  ArrowLeft,
} from "lucide-svelte";
import { getWorkspace, getWorkspaceByUser, forkWorkspace, getTreeByUser, type Tree, type WorkspaceDetail } from "$lib/api";
import { onMount } from "svelte";
import { goto } from "$app/navigation";

let { params } = $props();

let owner = $derived(params.owner);
let repo = $derived(params.repo);

let workspace = $state<WorkspaceDetail | null>(null);
let tree = $state<Tree | null>(null);
let isEmpty = $state(false);
let isLoading = $state(true);
let isForking = $state(false);
let loadError = $state("");
let copied = $state(false);
let currentUserUuid = $state<string | null>(null);

const gitRemoteUrl = $derived(workspace?.sshUrl || workspace?.cloneUrl || "");
const isOwner = $derived(currentUserUuid && workspace?.owner === currentUserUuid);

async function loadWorkspace() {
  isLoading = true;
  loadError = "";
  try {
    // Try to get current user info
    const me = await fetch("/api/me", { credentials: "include" }).then(r => r.ok ? r.json() : null).catch(() => null);
    currentUserUuid = me?.uuid || null;

    // Try to get workspace - first try as owner (by-user), then as public
    try {
      if (currentUserUuid && owner === currentUserUuid) {
        workspace = await getWorkspaceByUser(owner, repo);
      } else {
        // Try public access first
        const publicWs = await getWorkspace(owner, repo);
        // Then get detailed info if we're logged in
        if (currentUserUuid) {
          try {
            workspace = await getWorkspaceByUser(currentUserUuid, repo);
          } catch {
            // Not the owner, use public info
            workspace = publicWs as WorkspaceDetail;
          }
        } else {
          workspace = publicWs as WorkspaceDetail;
        }
      }
    } catch {
      // If public access fails and we're logged in, try as the current user
      if (currentUserUuid) {
        workspace = await getWorkspaceByUser(currentUserUuid, repo);
      } else {
        throw new Error("Workspace not found or access denied");
      }
    }

    // Get tree if we have access
    if (workspace && currentUserUuid) {
      tree = await getTreeByUser(workspace.owner, repo, "").catch(() => null);
      isEmpty = !tree || !tree.entries || tree.entries.length === 0;
    } else {
      tree = null;
      isEmpty = true;
    }
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
    const result = await forkWorkspace(owner, repo);
    // Navigate to the forked workspace
    goto(`/workspaces/${result.owner}/${result.giteaRepoName}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fork workspace";
    alert(message);
  } finally {
    isForking = false;
  }
}
</script>

<div class="space-y-8">
  {#if isLoading}
    <div class="bg-white border border-gray-200 rounded-2xl p-8 text-sm text-gray-500">Loading workspace...</div>
  {:else if loadError}
    <div class="bg-red-50 border border-red-200 text-red-700 p-6 rounded-2xl">
      <h2 class="text-lg font-semibold mb-2">Error</h2>
      <p class="text-sm break-all">{loadError}</p>
    </div>
  {:else if workspace}
    <div class="flex items-start justify-between bg-white p-6 rounded-2xl border border-gray-200 shadow-sm">
      <div class="flex items-center gap-4">
        <div class="w-12 h-12 rounded-xl bg-brand/5 text-brand flex items-center justify-center shrink-0">
          <FolderKanban class="w-6 h-6" />
        </div>
        <div>
          <div class="flex items-center gap-2 flex-wrap">
            <h1 class="text-2xl font-bold tracking-tight text-gray-900">{workspace.name}</h1>
            <span class="px-2 py-0.5 text-xs font-medium bg-gray-100 text-gray-600 rounded-md capitalize flex items-center gap-1">
              {#if workspace.visibility === "private"}
                <Lock class="w-3 h-3" /> Private
              {:else}
                <Globe class="w-3 h-3" /> Public
              {/if}
            </span>
          </div>
          <div class="flex items-center gap-2 mt-1 text-sm text-gray-500">
            <span>Owned by <span class="font-medium text-gray-700">{owner}</span></span>
            {#if workspace.forkedFrom}
              <span class="text-gray-300">•</span>
              <a href="/workspaces/{workspace.forkedFrom.ownerUsername || workspace.forkedFrom.owner}/{workspace.forkedFrom.name}" class="flex items-center gap-1 text-brand hover:underline">
                <GitFork class="w-3 h-3" />
                forked from {workspace.forkedFrom.ownerUsername}/{workspace.forkedFrom.name}
              </a>
            {/if}
          </div>
        </div>
      </div>

      <div class="flex items-center gap-3">
        {#if !isOwner && workspace.visibility === "public"}
          <button
            onclick={handleFork}
            disabled={isForking}
            class="px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-xl hover:bg-gray-800 transition-colors shadow-sm flex items-center gap-2 disabled:opacity-50"
          >
            <GitFork class="w-4 h-4" />
            {isForking ? "Forking..." : "Fork"}
          </button>
        {/if}
        {#if isOwner && !isEmpty}
          <button
            class="px-4 py-2 bg-brand text-white text-sm font-medium rounded-xl hover:bg-brand/90 transition-colors shadow-sm flex items-center gap-2 group"
            onclick={async () => {
              if (isLoading || !workspace) return;
              await goto(`/workspaces/${owner}/${repo}/runtimes/new`);
            }}
          >
            <Play class="w-4 h-4 fill-current group-hover:scale-110 transition-transform" />
            Start Runtime
          </button>
        {/if}
      </div>
    </div>

    {#if !isOwner && !currentUserUuid}
      <div class="bg-amber-50 border border-amber-200 text-amber-800 p-4 rounded-xl text-sm">
        <p>Log in to fork this workspace and start your own runtime.</p>
      </div>
    {/if}

    {#if isEmpty}
      <div class="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
        <div class="p-6 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
          <div>
            <h2 class="text-lg font-semibold text-gray-900">Repository Setup</h2>
            <p class="text-sm text-gray-500">This workspace is currently empty. Initialize it with Git.</p>
          </div>
          {#if gitRemoteUrl}
            <div class="flex items-center gap-2 bg-white px-3 py-1.5 rounded-lg border border-gray-200 font-mono text-xs text-gray-600">
              <span class="truncate max-w-[200px]">{gitRemoteUrl}</span>
              <button onclick={copyCloneUrl} class="p-1 hover:text-gray-900 hover:bg-gray-100 rounded transition-colors" title="Copy URL">
                {#if copied}
                  <Check class="w-3.5 h-3.5 text-green-600" />
                {:else}
                  <Copy class="w-3.5 h-3.5" />
                {/if}
              </button>
            </div>
          {/if}
        </div>

        {#if gitRemoteUrl}
          <div class="p-6 bg-gray-900 text-gray-300 font-mono text-sm leading-relaxed overflow-x-auto">
            <div class="flex items-center gap-2 text-gray-500 mb-4 select-none">
              <Terminal class="w-4 h-4" /> Create a new repository on the command line
            </div>
            <p>touch README.md</p>
            <p>git init</p>
            <p>git checkout -b main</p>
            <p>git add README.md</p>
            <p>git commit -m "first commit"</p>
            <p>git remote add origin {gitRemoteUrl}</p>
            <p>git push -u origin main</p>

            <div class="flex items-center gap-2 text-gray-500 mt-8 mb-4 select-none">
              <Terminal class="w-4 h-4" /> Or push an existing repository from the command line
            </div>
            <p>git remote add origin {gitRemoteUrl}</p>
            <p>git push -u origin main</p>
          </div>
        {/if}
      </div>
    {:else if tree}
      <div class="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
        <div class="px-4 py-3 border-b border-gray-200 bg-gray-50/80 flex items-center justify-between text-sm font-medium text-gray-700">
          <div class="flex items-center gap-2">
            <span>Name</span>
          </div>
        </div>
        <div class="divide-y divide-gray-100">
          {#each tree.entries as entry}
            <div class="px-4 py-3 flex items-center hover:bg-gray-50 transition-colors group cursor-pointer">
              <div class="flex items-center gap-3 min-w-0 flex-1">
                {#if entry.type === "dir"}
                  <Folder class="w-4 h-4 text-blue-500 fill-blue-500/20 shrink-0" />
                  <span class="text-sm font-medium text-gray-900 truncate group-hover:text-blue-600 transition-colors">{entry.name}</span>
                {:else}
                  <FileCode class="w-4 h-4 text-gray-400 shrink-0" />
                  <span class="text-sm text-gray-700 truncate group-hover:text-brand transition-colors">{entry.name}</span>
                {/if}
              </div>
            </div>
          {/each}
        </div>
      </div>
    {/if}
  {/if}
</div>
