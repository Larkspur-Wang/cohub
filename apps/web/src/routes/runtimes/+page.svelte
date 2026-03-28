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

function statusBadge(status: string) {
  if (status === "running") return "neo-badge neo-badge-green";
  if (status === "starting" || status === "active") return "neo-badge neo-badge-yellow";
  if (status === "error") return "neo-badge neo-badge-red";
  return "neo-badge neo-badge-white";
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

<div class="neo-page-shell">
  <div>
    <h1 class="neo-page-title">Runtimes</h1>
    <p class="neo-page-desc mt-3 max-w-2xl">Inspect active runtimes and jump directly into the console for each running agent.</p>
  </div>

  {#if isLoading}
    <div class="neo-loading">Loading runtimes...</div>
  {:else if loadError}
    <div class="neo-error">
      <h2 class="neo-section-title text-white">Load Failed</h2>
      <p class="mt-2 text-sm font-bold break-all">{loadError}</p>
    </div>
  {:else if runtimes.length === 0}
    <div class="neo-empty">
      <div class="neo-icon-box neo-fill-yellow mx-auto mb-4"><Cpu class="w-5 h-5" /></div>
      <h3 class="neo-section-title">No Runtimes Yet</h3>
      <p class="neo-page-desc mt-3 text-sm">Create a runtime from a workspace to see it here.</p>
    </div>
  {:else}
    <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
      {#each runtimes as runtime}
        {@const status = displayStatus(runtime)}
        <a href="/runtimes/{runtime.id}" class="neo-list-card p-4 bg-white flex flex-col gap-4">
          <div class="flex items-start justify-between gap-3">
            <div class="neo-icon-box neo-fill-pink">
              <Play class="w-5 h-5" />
            </div>
            <span class={statusBadge(status)}>{status}</span>
          </div>

          <div>
            <h3 class="text-lg font-black uppercase tracking-tight line-clamp-2">{runtime.title || "Untitled Runtime"}</h3>
            <div class="text-xs font-mono break-all text-black/55">{runtime.id}</div>
          </div>

          <div class="flex flex-wrap gap-2 text-[11px] font-bold text-black/70">
            <span class="neo-badge neo-badge-white normal-case tracking-normal">workspace: {runtime.workspaceId ?? "unbound"}</span>
            <span class="neo-badge neo-badge-white normal-case tracking-normal">sessions: —</span>
          </div>

          <div class="mt-auto flex items-center justify-between gap-3 border-t-[3px] border-black pt-3 text-[11px] font-bold text-black/55">
            <span class="inline-flex items-center gap-1"><FolderKanban class="w-3.5 h-3.5" /> Runtime Console</span>
            <span>{new Date(runtime.updatedAt).toLocaleString()}</span>
          </div>
        </a>
      {/each}
    </div>
  {/if}
</div>
