<script lang="ts">
import type { UserSshKey } from "@cohub/sdk";
import { KeyRound, Plus, Trash2, X } from "lucide-svelte";
import { onMount } from "svelte";
import { fade } from "svelte/transition";
import { page } from "$app/state";
import { ensureAuth, logtoClient } from "$lib/auth";
import { sdk } from "$lib/sdk";

const currentPath = $derived(page.url.pathname);
const currentSearch = $derived(page.url.search);

let keys = $state<UserSshKey[]>([]);
let isLoading = $state(true);
let loadError = $state("");

let isAdding = $state(false);
let isSubmitting = $state(false);

let formTitle = $state("");
let formKey = $state("");

async function loadKeys() {
	if (!(await ensureAuth({ redirectPath: `${currentPath}${currentSearch}` })))
		return;
	isLoading = true;
	loadError = "";
	try {
		keys = await sdk.user.getSshKeys();
	} catch (error) {
		const message =
			error instanceof Error ? error.message : "Failed to load SSH keys";
		if (message.includes("unauthorized") || message.includes("401")) {
			await logtoClient.signIn(`${window.location.origin}/callback`);
			return;
		}
		loadError = message;
	} finally {
		isLoading = false;
	}
}

async function handleSubmit(e: Event) {
	e.preventDefault();
	if (!formTitle.trim() || !formKey.trim() || isSubmitting) return;

	isSubmitting = true;
	try {
		await sdk.user.createSshKey({
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
	if (!confirm("Are you sure you want to delete this SSH key?")) return;
	try {
		await sdk.user.deleteSshKey(id);
		await loadKeys();
	} catch (error) {
		alert(error instanceof Error ? error.message : "Failed to delete SSH key");
	}
}

onMount(() => {
	void loadKeys();
});
</script>

<div class="flex-1 flex flex-col min-h-0 overflow-y-auto">
  <div class="flex-1 p-6 overflow-y-auto">
    <section class="max-w-xl">
      <h1 class="text-[18px] font-semibold text-text-primary tracking-tight">SSH Keys</h1>
      <p class="mt-1 text-[13px] text-text-tertiary">
        Add your public SSH keys to enable Git push to your spaces.
      </p>

      {#if isAdding}
        <div class="mt-6 border border-border-subtle rounded-md bg-bg-surface p-4" in:fade>
          <div class="flex items-center justify-between mb-4">
            <h3 class="text-[13px] font-medium text-text-primary">Add SSH Key</h3>
            <button onclick={() => (isAdding = false)} class="text-text-tertiary hover:text-text-secondary transition-colors cursor-pointer">
              <X class="w-4 h-4" />
            </button>
          </div>

          <form onsubmit={handleSubmit} class="space-y-3">
            <div>
              <label class="block text-[10px] font-medium uppercase tracking-wider text-text-tertiary mb-1.5" for="key-title">Title</label>
              <input
                id="key-title"
                type="text"
                bind:value={formTitle}
                placeholder="MacBook Pro"
                class="w-full px-3 py-[6px] rounded-[5px] bg-bg-input border border-border-subtle text-[13px] text-text-primary placeholder:text-text-placeholder focus:border-brand/40 focus:outline-none transition-colors"
                required
              />
            </div>

            <div>
              <label class="block text-[10px] font-medium uppercase tracking-wider text-text-tertiary mb-1.5" for="key-value">Public Key</label>
              <textarea
                id="key-value"
                bind:value={formKey}
                placeholder="ssh-ed25519 AAAA..."
                class="w-full px-3 py-[6px] rounded-[5px] bg-bg-input border border-border-subtle text-[13px] text-text-primary placeholder:text-text-placeholder focus:border-brand/40 focus:outline-none font-mono resize-y min-h-[4rem] transition-colors"
                rows={3}
                required
              ></textarea>
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              class="px-4 py-[6px] rounded-[5px] bg-[#FF3E00] hover:bg-brand-hover text-[12px] text-white font-medium transition-colors disabled:opacity-50"
            >
              {isSubmitting ? "Saving..." : "Add Key"}
            </button>
          </form>
        </div>
      {:else}
        <button
          onclick={() => (isAdding = true)}
          class="mt-4 flex items-center gap-1.5 px-3 py-1.5 rounded-[5px] bg-bg-hover hover:bg-bg-hover-strong border border-border-subtle text-[12px] text-text-secondary hover:text-text-primary transition-colors cursor-pointer"
        >
          <Plus class="w-3.5 h-3.5" />
          Add SSH Key
        </button>
      {/if}

      <!-- Keys List -->
      {#if isLoading}
        <div class="flex items-center justify-center py-12 text-[12px] text-text-tertiary">
          <div class="w-4 h-4 rounded-full border-2 border-border-subtle border-t-brand animate-spin mr-2"></div>
          Loading SSH keys...
        </div>
      {:else if loadError}
        <div class="mt-4 rounded-md border border-error-soft/30 bg-error-bg p-3 text-[12px] font-mono text-error-soft break-all">{loadError}</div>
      {:else if keys.length === 0}
        <div class="flex flex-col items-center justify-center py-16 text-center">
          <div class="w-11 h-11 rounded-md bg-bg-surface border border-border-subtle flex items-center justify-center mb-3">
            <KeyRound class="w-5 h-5 text-text-placeholder" />
          </div>
          <p class="text-[14px] text-text-tertiary">No SSH keys</p>
          <p class="text-[12px] text-text-placeholder mt-1">Add an SSH key to push to your repositories</p>
        </div>
      {:else}
        <div class="mt-6 space-y-2">
          {#each keys as key (key.id)}
            <div class="group flex items-start gap-3 p-3 rounded-[5px] border border-border-subtle bg-bg-surface hover:border-border-primary transition-colors duration-100">
              <div class="w-8 h-8 rounded-[5px] bg-warning-bg border border-warning-soft/30 flex items-center justify-center shrink-0 mt-0.5">
                <KeyRound class="w-4 h-4 text-warning-soft" />
              </div>
              <div class="flex-1 min-w-0">
                <h4 class="text-[13px] font-medium text-text-primary">{key.title}</h4>
                <code class="mt-1 block text-[11px] font-mono bg-bg-code px-2 py-1 rounded-sm text-text-tertiary truncate">{key.key.slice(0, 60)}...</code>
                <p class="mt-1 text-[11px] text-text-placeholder">Added {new Date(key.createdAt).toLocaleDateString()}</p>
              </div>
              <button
                onclick={() => handleDelete(key.id)}
                class="p-2 rounded-[4px] text-text-tertiary hover:text-error-soft hover:bg-error-bg transition-all shrink-0 cursor-pointer"
                title="Delete SSH key"
              >
                <Trash2 class="w-4 h-4" />
              </button>
            </div>
          {/each}
        </div>
      {/if}
    </section>
  </div>
</div>
