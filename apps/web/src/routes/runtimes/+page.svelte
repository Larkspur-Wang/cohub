<script lang="ts">
import { Cpu, Play, FolderKanban } from "lucide-svelte";
import { getRuntimes, type RuntimeListItem } from "$lib/api";
import { onMount } from "svelte";
import { goto } from "$app/navigation";

let runtimes = $state<RuntimeListItem[]>([]);
let isLoading = $state(true);
let loadError = $state("");

function displayStatus(runtime: RuntimeListItem) {
  return runtime.liveStatus ?? runtime.status ?? "unknown";
}

function statusClasses(status: string) {
  if (status === "running") return "bg-green-50 text-green-700";
  if (status === "starting" || status === "active") return "bg-yellow-50 text-yellow-700";
  if (status === "error") return "bg-red-50 text-red-700";
  if (status === "stopped") return "bg-gray-100 text-gray-600";
  return "bg-gray-100 text-gray-600";
}

async function loadRuntimes() {
  isLoading = true;
  loadError = "";
  try {
    runtimes = await getRuntimes();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load runtimes";
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
  loadRuntimes();
});
</script>

<div class="space-y-8">
  <div class="flex items-center justify-between">
    <div>
      <h1 class="text-3xl font-bold tracking-tight text-gray-900">Runtimes</h1>
      <p class="mt-2 text-sm text-gray-500">Inspect your created runtimes and jump into their console.</p>
    </div>
  </div>

  {#if isLoading}
    <div class="bg-white border border-gray-200 rounded-2xl p-8 text-sm text-gray-500">Loading runtimes...</div>
  {:else if loadError}
    <div class="bg-red-50 border border-red-200 text-red-700 p-6 rounded-2xl">
      <h2 class="text-lg font-semibold mb-2">Failed to load runtimes</h2>
      <p class="text-sm break-all">{loadError}</p>
    </div>
  {:else if runtimes.length === 0}
    <div class="text-center py-16 bg-white border border-gray-200 border-dashed rounded-3xl">
      <div class="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-4">
        <Cpu class="w-8 h-8 text-gray-400" />
      </div>
      <h3 class="text-lg font-medium text-gray-900 mb-1">No runtimes yet</h3>
      <p class="text-sm text-gray-500">Create a runtime from a workspace to see it here.</p>
    </div>
  {:else}
    <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
      {#each runtimes as runtime}
        {@const status = displayStatus(runtime)}
        <a href="/runtimes/{runtime.id}" class="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 flex flex-col group hover:border-brand/30 transition-colors">
          <div class="flex items-start justify-between mb-4 gap-4">
            <div class="w-12 h-12 rounded-xl bg-brand/5 text-brand flex items-center justify-center group-hover:bg-brand group-hover:text-white transition-colors">
              <Play class="w-6 h-6" />
            </div>
            <span class="px-2 py-1 text-xs font-medium rounded-md capitalize {statusClasses(status)}">{status}</span>
          </div>

          <h3 class="text-lg font-semibold text-gray-900 truncate group-hover:text-brand transition-colors">
            {runtime.title || "Untitled Runtime"}
          </h3>

          <div class="mt-2 text-sm text-gray-500 font-mono break-all min-h-[2.5rem]">
            {runtime.id}
          </div>

          <div class="mt-4 flex flex-wrap gap-2 text-xs text-gray-500">
            <span class="px-2 py-1 rounded-full bg-gray-100">workspace: {runtime.workspaceId ?? "unbound"}</span>
            <span class="px-2 py-1 rounded-full bg-gray-100">session: {runtime.currentSessionId ?? "none"}</span>
          </div>

          <div class="mt-6 pt-4 border-t border-gray-100 flex items-center justify-between text-xs text-gray-400">
            <span class="inline-flex items-center gap-1"><FolderKanban class="w-3.5 h-3.5" /> Runtime Console</span>
            <span>{new Date(runtime.updatedAt).toLocaleString()}</span>
          </div>
        </a>
      {/each}
    </div>
  {/if}
</div>
