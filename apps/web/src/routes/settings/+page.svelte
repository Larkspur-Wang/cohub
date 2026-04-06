<script lang="ts">
import { Plus, Trash2, KeyRound, X, Sun, Moon, Monitor } from "lucide-svelte";
import { getSshKeys, createSshKey, deleteSshKey, type UserSshKey } from "$lib/api";
import { fade } from "svelte/transition";
import { onMount } from "svelte";
import { ensureAuth, logtoClient } from "$lib/auth";
import { getTheme, setTheme, type ThemeMode } from "$lib/theme";

let theme = $state<ThemeMode>(getTheme());

const themeOptions: { value: ThemeMode; label: string; icon: typeof Sun }[] = [
  { value: "dark", label: "Dark", icon: Moon },
  { value: "light", label: "Light", icon: Sun },
  { value: "system", label: "System", icon: Monitor },
];

function handleThemeChange(mode: ThemeMode) {
  theme = mode;
  setTheme(mode);
}

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
  if (!confirm("Are you sure you want to delete this SSH key?")) return;
  try {
    await deleteSshKey(id);
    await loadKeys();
  } catch (error) {
    alert(error instanceof Error ? error.message : "Failed to delete SSH key");
  }
}
</script>

<div class="flex-1 flex flex-col min-h-0 overflow-y-auto">
  <!-- Header -->
  <div class="h-10 flex items-center px-4 border-b border-border-primary shrink-0 bg-bg-primary">
    <span class="text-xs font-medium text-text-secondary">Settings</span>
  </div>

  <div class="flex-1 p-4 overflow-y-auto max-w-3xl">
    <!-- Appearance Section -->
    <div class="mb-8">
      <h2 class="text-sm font-medium text-text-primary mb-1">Appearance</h2>
      <p class="text-xs text-text-tertiary mb-4">Choose your preferred theme.</p>

      <div class="flex gap-2">
        {#each themeOptions as option}
          <button
            type="button"
            class="flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg border text-xs font-medium transition-colors {
              theme === option.value
                ? 'border-border-primary bg-hover-strong text-text-primary'
                : 'border-border-primary bg-bg-surface text-text-tertiary hover:text-text-secondary hover:bg-bg-surface-hover'
            }"
            onclick={() => handleThemeChange(option.value)}
          >
            <option.icon class="w-4 h-4" />
            {option.label}
          </button>
        {/each}
      </div>
    </div>

    <!-- SSH Keys Section -->
    <div class="mb-6">
      <h2 class="text-sm font-medium text-text-primary mb-1">SSH Keys</h2>
      <p class="text-xs text-text-tertiary mb-4">Add your SSH public keys to enable pushing to workspace repositories via SSH.</p>

      {#if isAdding}
        <div class="mb-4 border border-border-primary rounded-lg bg-bg-surface p-4" in:fade>
          <div class="flex items-center justify-between mb-4">
            <h3 class="text-sm font-medium text-text-primary">Add SSH Key</h3>
            <button onclick={() => isAdding = false} class="text-text-tertiary hover:text-text-secondary transition-colors">
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
                class="w-full px-3 py-1.5 rounded-md bg-bg-input border border-border-primary text-xs text-text-primary placeholder:text-text-placeholder focus:border-border-primary/30 focus:outline-none"
                required
              />
            </div>

            <div>
              <label class="block text-[10px] font-medium uppercase tracking-wider text-text-tertiary mb-1.5" for="key-value">Public Key</label>
              <textarea
                id="key-value"
                bind:value={formKey}
                placeholder="ssh-ed25519 AAAA..."
                class="w-full px-3 py-1.5 rounded-md bg-bg-input border border-border-primary text-xs text-text-primary placeholder:text-text-placeholder focus:border-border-primary/30 focus:outline-none font-mono resize-y min-h-[4rem]"
                rows={3}
                required
              ></textarea>
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              class="px-4 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-500 text-xs text-white font-medium transition-colors disabled:opacity-50"
            >
              {isSubmitting ? "Saving..." : "Add Key"}
            </button>
          </form>
        </div>
      {:else}
        <button
          onclick={() => isAdding = true}
          class="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-hover hover:bg-hover-strong border border-border-primary text-xs text-text-secondary hover:text-text-primary transition-colors mb-4"
        >
          <Plus class="w-3.5 h-3.5" />
          Add SSH Key
        </button>
      {/if}
    </div>

    <!-- Keys List -->
    {#if isLoading}
      <div class="flex items-center justify-center py-12 text-xs text-text-tertiary">
        <div class="w-4 h-4 rounded-full border-2 border-white/15 border-t-emerald-400 animate-spin mr-2"></div>
        Loading SSH keys...
      </div>
    {:else if loadError}
      <div class="rounded-md border border-rose-500/20 bg-rose-500/10 p-3 text-xs font-mono text-rose-400 break-all">{loadError}</div>
    {:else if keys.length === 0}
      <div class="flex flex-col items-center justify-center py-12 text-center">
        <div class="w-10 h-10 rounded-full bg-hover border border-border-primary flex items-center justify-center mb-3">
          <KeyRound class="w-4 h-4 text-text-placeholder" />
        </div>
        <p class="text-sm text-text-tertiary">No SSH keys</p>
        <p class="text-xs text-text-placeholder mt-1">Add an SSH key to push to your workspace repositories</p>
      </div>
    {:else}
      <div class="space-y-2">
        {#each keys as key (key.id)}
          <div class="group flex items-start gap-3 p-3 rounded-lg border border-border-primary bg-bg-surface hover:border-border-primary/20 transition-colors">
            <div class="w-8 h-8 rounded-md bg-yellow-500/10 border border-yellow-500/20 flex items-center justify-center shrink-0 mt-0.5">
              <KeyRound class="w-4 h-4 text-yellow-400/70" />
            </div>
            <div class="flex-1 min-w-0">
              <h4 class="text-sm font-medium text-text-primary">{key.title}</h4>
              <code class="mt-1 block text-[10px] font-mono bg-bg-code px-2 py-1 rounded text-text-tertiary truncate">{key.key.slice(0, 60)}...</code>
              <p class="mt-1 text-[10px] text-text-placeholder">Added {new Date(key.createdAt).toLocaleDateString()}</p>
            </div>
            <button
              onclick={() => handleDelete(key.id)}
              class="p-1.5 rounded text-text-placeholder hover:text-rose-400 hover:bg-rose-500/10 opacity-0 group-hover:opacity-100 transition-all shrink-0"
              title="Delete SSH key"
            >
              <Trash2 class="w-3.5 h-3.5" />
            </button>
          </div>
        {/each}
      </div>
    {/if}
  </div>
</div>
