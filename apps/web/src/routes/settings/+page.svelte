<script lang="ts">
import { Plus, Trash2, KeyRound, X } from "lucide-svelte";
import { getSshKeys, createSshKey, deleteSshKey, type UserSshKey } from "$lib/api";
import { fade } from "svelte/transition";
import { onMount } from "svelte";
import { ensureAuth, logtoClient } from "$lib/auth";

let keys = $state<UserSshKey[]>([]);
let isLoading = $state(true);
let loadError = $state("");

let isAdding = $state(false);
let isSubmitting = $state(false);

let formTitle = $state("");
let formKey = $state("");

async function loadKeys() {
  if (!(await ensureAuth())) return;
  isLoading = true;
  loadError = "";
  try {
    keys = await getSshKeys();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load SSH keys";
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
  loadKeys();
});

async function handleSubmit(e: Event) {
  e.preventDefault();
  if (!formTitle.trim() || !formKey.trim() || isSubmitting) return;

  isSubmitting = true;
  try {
    await createSshKey({
      key: formKey.trim(),
      title: formTitle.trim(),
    });
    isAdding = false;
    formTitle = "";
    formKey = "";
    await loadKeys();
  } catch (error) {
    alert(error instanceof Error ? error.message : "Failed to add SSH key");
  } finally {
    isSubmitting = false;
  }
}

async function handleDelete(id: string) {
  if (!confirm("Are you sure you want to delete this SSH key? This may affect your ability to push to Gitea.")) return;
  try {
    await deleteSshKey(id);
    await loadKeys();
  } catch (error) {
    alert(error instanceof Error ? error.message : "Failed to delete SSH key");
  }
}
</script>

<div class="neo-page-shell">
  <div class="neo-page-header">
    <div>
      <h1 class="neo-page-title">Settings</h1>
      <p class="neo-page-desc mt-3 max-w-2xl">Manage your account settings including SSH keys for Git access.</p>
    </div>
  </div>

  <div class="space-y-6">
    <h2 class="neo-section-title">SSH Keys</h2>
    <p class="neo-page-desc text-sm">Add your SSH public keys to enable pushing to your workspace repositories via SSH. Your keys are registered with Gitea automatically.</p>

    {#if isAdding}
      <div transition:fade class="neo-card p-5 md:p-6 bg-white">
        <div class="flex items-center justify-between gap-4 mb-5">
          <div>
            <h3 class="neo-section-title">Add SSH Key</h3>
            <p class="neo-page-desc mt-2 text-sm">Paste your public key. You can find it by running <code class="px-1.5 py-0.5 bg-black/5 rounded text-xs font-mono">cat ~/.ssh/id_ed25519.pub</code> on your machine.</p>
          </div>
          <button onclick={() => (isAdding = false)} class="neo-btn neo-btn-secondary !px-3 !py-2">
            <X class="w-4 h-4" />
            Close
          </button>
        </div>

        <form onsubmit={handleSubmit} class="space-y-4">
          <div>
            <label class="neo-meta mb-2 block" for="title">Title</label>
            <input type="text" id="title" bind:value={formTitle} placeholder="MacBook Pro" class="neo-input" required />
          </div>

          <div>
            <label class="neo-meta mb-2 block" for="key">Public Key</label>
            <textarea id="key" bind:value={formKey} placeholder="ssh-ed25519 AAAA..." class="neo-input resize-y min-h-[5rem] font-mono text-sm" required rows={3}></textarea>
          </div>

          <div>
            <button type="submit" disabled={isSubmitting} class="neo-btn neo-btn-primary disabled:opacity-50">
              {isSubmitting ? "Saving..." : "Add Key"}
            </button>
          </div>
        </form>
      </div>
    {:else}
      <button onclick={() => (isAdding = true)} class="neo-btn neo-btn-primary w-fit">
        <Plus class="w-4 h-4" />
        Add SSH Key
      </button>
    {/if}

    {#if isLoading}
      <div class="neo-loading">Loading SSH keys...</div>
    {:else if loadError}
      <div class="neo-error">
        <h3 class="neo-section-title text-white">Load Failed</h3>
        <p class="mt-2 text-sm font-bold break-all">{loadError}</p>
      </div>
    {:else if keys.length === 0}
      <div class="neo-empty">
        <div class="neo-icon-box neo-fill-yellow mx-auto mb-4"><KeyRound class="w-5 h-5" /></div>
        <h3 class="neo-section-title">No SSH Keys</h3>
        <p class="neo-page-desc mt-3 text-sm">Add an SSH key to push to your workspace repositories via SSH.</p>
      </div>
    {:else}
      <div class="space-y-3">
        {#each keys as key}
          <div class="neo-list-card p-4 bg-white flex flex-col sm:flex-row sm:items-center gap-4 group">
            <div class="flex items-start gap-3 flex-1 min-w-0">
              <div class="neo-icon-box neo-fill-yellow shrink-0"><KeyRound class="w-5 h-5" /></div>
              <div class="min-w-0">
                <h4 class="text-lg font-black uppercase tracking-tight">{key.title}</h4>
                <code class="mt-1 block text-xs font-mono bg-black/5 px-2 py-1 rounded truncate w-full">{key.key.slice(0, 60)}...</code>
                <p class="mt-1 text-[11px] font-bold uppercase tracking-widest text-black/40">Added {new Date(key.createdAt).toLocaleDateString()}</p>
              </div>
            </div>
            <button
              onclick={() => handleDelete(key.id)}
              class="neo-btn neo-btn-secondary !px-2.5 !py-2 shrink-0 opacity-0 group-hover:opacity-100"
              title="Delete SSH key"
            >
              <Trash2 class="w-4 h-4 text-red-600" />
            </button>
          </div>
        {/each}
      </div>
    {/if}
  </div>
</div>
