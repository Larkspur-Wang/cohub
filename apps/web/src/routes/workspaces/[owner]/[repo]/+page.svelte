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
} from "lucide-svelte";
import { createRuntime, getTreeByUser, getWorkspaceByUser, type Tree, type WorkspaceDetail } from "$lib/api";
import { onMount } from "svelte";
import { goto } from "$app/navigation";

let { params } = $props();

let userUuid = $derived(params.owner);
let repo = $derived(params.repo);

let workspace = $state<WorkspaceDetail | null>(null);
let tree = $state<Tree | null>(null);
let isEmpty = $state(false);
let isLoading = $state(true);
let loadError = $state("");
let copied = $state(false);

const gitRemoteUrl = $derived(workspace?.sshUrl || workspace?.cloneUrl || "");

async function loadWorkspace() {
  isLoading = true;
  loadError = "";
  try {
    workspace = await getWorkspaceByUser(userUuid, repo);
    tree = await getTreeByUser(userUuid, repo, "").catch(() => null);
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
          <div class="flex items-center gap-2">
            <h1 class="text-2xl font-bold tracking-tight text-gray-900">{repo}</h1>
            <span class="px-2 py-0.5 text-xs font-medium bg-gray-100 text-gray-600 rounded-md capitalize flex items-center gap-1">
              {#if workspace.private}
                <Lock class="w-3 h-3" /> Private
              {:else}
                <Globe class="w-3 h-3" /> Public
              {/if}
            </span>
          </div>
          <p class="text-sm text-gray-500 mt-1">
            Workspace owner <span class="font-medium text-gray-700">{userUuid}</span>
          </p>
        </div>
      </div>

      <div class="flex items-center gap-3">
        {#if !isEmpty}
          <button
            class="px-4 py-2 bg-brand text-white text-sm font-medium rounded-xl hover:bg-brand/90 transition-colors shadow-sm flex items-center gap-2 group"
            onclick={async () => {
              if (isLoading) return;
              try {
                if (!workspace) return;
                const runtime = await createRuntime({
                  workspaceId: workspace.id,
                  title: workspace.name,
                  start: true,
                });
                await goto(`/runtimes/${runtime.runtime.id}`);
              } catch (error) {
                loadError = error instanceof Error ? error.message : "Failed to start runtime";
              }
            }}
          >
            <Play class="w-4 h-4 fill-current group-hover:scale-110 transition-transform" />
            Start Runtime
          </button>
        {/if}
      </div>
    </div>

    {#if isEmpty}
      <div class="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
        <div class="p-6 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
          <div>
            <h2 class="text-lg font-semibold text-gray-900">Repository Setup</h2>
            <p class="text-sm text-gray-500">This workspace is currently empty. Initialize it with Git.</p>
          </div>
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
        </div>

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
