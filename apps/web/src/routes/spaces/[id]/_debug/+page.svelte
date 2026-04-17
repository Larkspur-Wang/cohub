<script lang="ts">
import { goto } from "$app/navigation";
import {
  getSpaceSandbox,
  getSpace,
  recreateSpaceSandbox,
  type SandboxRecord,
  type SpaceRecord,
} from "$lib/api";
import { ArrowLeft, Loader2, RefreshCw, Trash2 } from "lucide-svelte";

type Props = {
  data: {
    spaceId: string;
    space: SpaceRecord;
  };
};

const props = $props();
const data = $derived((props as Props).data);

let space = $state<SpaceRecord | null>(data.space);
const spaceId = $derived(data.spaceId);
let sandbox = $state<SandboxRecord | null>(null);
let loading = $state(true);
let loadError = $state("");
let recreating = $state(false);
let recreateError = $state("");
let recreateSuccess = $state("");

const statusColor = $derived.by(() => {
  if (!sandbox) return "text-text-tertiary";
  switch (sandbox.status) {
    case "ready":
      return "text-green-500";
    case "error":
      return "text-red-500";
    case "provisioning":
      return "text-yellow-500";
    case "stopped":
    case "terminated":
      return "text-text-tertiary";
    default:
      return "text-text-tertiary";
  }
});

async function loadData() {
  loading = true;
  loadError = "";
  try {
    const [spaceRes, sandboxRes] = await Promise.all([
      getSpace(data.spaceId),
      getSpaceSandbox(data.spaceId),
    ]);
    space = spaceRes;
    sandbox = sandboxRes.sandbox;
  } catch (e) {
    loadError = e instanceof Error ? e.message : "Failed to load";
  } finally {
    loading = false;
  }
}

async function handleRecreate() {
  if (recreating) return;
  if (!confirm("确认删除并重建此 sandbox？当前正在运行的会话会中断。")) return;

  recreating = true;
  recreateError = "";
  recreateSuccess = "";
  try {
    await recreateSpaceSandbox(data.spaceId);
    recreateSuccess = "Sandbox 重建已触发，等待启动中…";
    await new Promise((r) => setTimeout(r, 2000));
    await loadData();
  } catch (e) {
    recreateError = e instanceof Error ? e.message : "Failed to recreate";
  } finally {
    recreating = false;
  }
}

function formatTime(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("zh-CN");
}

function formatMeta(meta: Record<string, unknown> | null) {
  if (!meta) return "—";
  return JSON.stringify(meta, null, 2);
}

$effect(() => {
  loadData();
});
</script>

<div class="min-h-screen bg-bg-content">
  <div class="max-w-2xl mx-auto px-4 py-6">
    <!-- Back button -->
    <button
      type="button"
      class="flex items-center gap-1.5 text-[13px] text-text-tertiary hover:text-text-secondary mb-6"
      onclick={() => goto(`/spaces/${spaceId}`)}
    >
      <ArrowLeft class="w-3.5 h-3.5" />
      <span>Back to space</span>
    </button>

    <h1 class="text-lg font-semibold text-text-primary mb-6">Space Debug</h1>

    {#if loadError}
      <div class="mb-4 rounded-md border border-error-soft/30 bg-error-bg p-3 text-[12px] font-mono text-error-soft break-all">{loadError}</div>
    {/if}

    {#if recreateError}
      <div class="mb-4 rounded-md border border-error-soft/30 bg-error-bg p-3 text-[12px] font-mono text-error-soft break-all">{recreateError}</div>
    {/if}

    {#if recreateSuccess}
      <div class="mb-4 rounded-md border border-green-500/30 bg-green-500/10 p-3 text-[12px] text-green-500">{recreateSuccess}</div>
    {/if}

    {#if loading}
      <div class="flex items-center justify-center py-12">
        <Loader2 class="w-5 h-5 text-text-tertiary animate-spin" />
      </div>
    {:else}
      <!-- Space Info -->
      <div class="mb-6 rounded-lg border border-border-subtle bg-bg-elevated/50 p-4">
        <h2 class="text-[13px] font-medium text-text-secondary mb-3">Space Info</h2>
        <dl class="space-y-2 text-[13px]">
          <div class="flex gap-3">
            <dt class="w-24 shrink-0 text-text-tertiary">ID</dt>
            <dd class="font-mono text-text-primary break-all">{space?.id}</dd>
          </div>
          <div class="flex gap-3">
            <dt class="w-24 shrink-0 text-text-tertiary">Name</dt>
            <dd class="text-text-primary">{space?.name ?? "—"}</dd>
          </div>
          <div class="flex gap-3">
            <dt class="w-24 shrink-0 text-text-tertiary">User</dt>
            <dd class="font-mono text-text-primary break-all">{space?.userUuid ?? "—"}</dd>
          </div>
          <div class="flex gap-3">
            <dt class="w-24 shrink-0 text-text-tertiary">Repo</dt>
            <dd class="font-mono text-text-primary break-all">{space?.storageRepoName ?? "—"}</dd>
          </div>
          <div class="flex gap-3">
            <dt class="w-24 shrink-0 text-text-tertiary">Created</dt>
            <dd class="text-text-primary">{formatTime(space?.createdAt ?? null)}</dd>
          </div>
        </dl>
      </div>

      <!-- Sandbox Status -->
      <div class="mb-6 rounded-lg border border-border-subtle bg-bg-elevated/50 p-4">
        <h2 class="text-[13px] font-medium text-text-secondary mb-3">Sandbox</h2>
        {#if sandbox}
          <dl class="space-y-2 text-[13px]">
            <div class="flex gap-3">
              <dt class="w-24 shrink-0 text-text-tertiary">Status</dt>
              <dd class="flex items-center gap-1.5">
                <span class={"inline-block w-2 h-2 rounded-full " + statusColor.replace("text-", "bg-")}></span>
                <span class={statusColor}>{sandbox.status}</span>
              </dd>
            </div>
            <div class="flex gap-3">
              <dt class="w-24 shrink-0 text-text-tertiary">Pod</dt>
              <dd class="font-mono text-text-primary">{sandbox.podName ?? "—"}</dd>
            </div>
            <div class="flex gap-3">
              <dt class="w-24 shrink-0 text-text-tertiary">Heartbeat</dt>
              <dd class="text-text-primary">{formatTime(sandbox.lastHeartbeatAt)}</dd>
            </div>
            <div class="flex gap-3">
              <dt class="w-24 shrink-0 text-text-tertiary">Updated</dt>
              <dd class="text-text-primary">{formatTime(sandbox.updatedAt)}</dd>
            </div>
            {#if sandbox.meta}
              <div class="flex gap-3">
                <dt class="w-24 shrink-0 text-text-tertiary">Meta</dt>
                <dd class="text-text-primary">
                  <pre class="text-[11px] font-mono bg-bg-content rounded p-2 overflow-x-auto whitespace-pre-wrap break-all">{formatMeta(sandbox.meta)}</pre>
                </dd>
              </div>
            {/if}
          </dl>
        {:else}
          <p class="text-[13px] text-text-tertiary">No sandbox record found.</p>
        {/if}
      </div>

      <!-- Actions -->
      <div class="flex flex-wrap gap-3">
        <button
          type="button"
          class="flex items-center gap-2 px-3 h-9 rounded-md bg-red-500/10 text-red-500 hover:bg-red-500/20 text-[13px] font-medium disabled:opacity-50 transition-colors"
          onclick={handleRecreate}
          disabled={recreating}
        >
          {#if recreating}
            <Loader2 class="w-4 h-4 animate-spin" />
          {:else}
            <RefreshCw class="w-4 h-4" />
          {/if}
          <span>Recreate Sandbox</span>
        </button>

        <button
          type="button"
          class="flex items-center gap-2 px-3 h-9 rounded-md bg-bg-hover text-text-secondary hover:bg-bg-elevated text-[13px] font-medium transition-colors"
          onclick={() => loadData()}
        >
          <Trash2 class="w-4 h-4" />
          <span>Refresh</span>
        </button>
      </div>
    {/if}
  </div>
</div>
