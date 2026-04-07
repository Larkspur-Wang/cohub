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
  <div class="h-[40px] flex items-center px-4 border-b border-border-subtle shrink-0 bg-bg-primary">
    <span class="text-[11px] font-medium text-text-secondary">Settings</span>
  </div>

  <div class="flex-1 p-6 overflow-y-auto max-w-2xl">
    <!-- Appearance Section -->
    <section class="mb-10">
      <h2 class="text-[14px] font-semibold text-text-primary mb-1">Appearance</h2>
      <p class="text-[13px] text-text-tertiary mb-4">Choose your preferred theme.</p>

      <div class="flex gap-2">
        {#each themeOptions as option}
          <button
            type="button"
            class="flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-[5px] border text-[13px] font-medium transition-colors duration-100 {
              theme === option.value
                ? 'border-brand/40 bg-brand-bg text-text-primary'
                : 'border-border-subtle bg-bg-surface text-text-tertiary hover:text-text-secondary hover:bg-bg-surface-hover'
            }"
            onclick={() => handleThemeChange(option.value)}
          >
            <option.icon class="w-4 h-4" />
            {option.label}
          </button>
        {/each}
      </div>
    </section>

    <!-- SSH Keys Section -->
    <section>
      <h2 class="text-[14px] font-semibold text-text-primary mb-1">SSH Keys</h2>
      <p class="text-[13px] text-text-tertiary mb-4">Add your SSH public keys to enable pushing to workspace repositories via SSH.</p>

      {#if isAdding}
        <div class="mb-4 border border-border-subtle rounded-md bg-bg-surface p-4" in:fade>
          <div class="flex items-center justify-between mb-4">
            <h3 class="text-[13px] font-medium text-text-primary">Add SSH Key</h3>
            <button onclick={() => isAdding = false} class="text-text-tertiary hover:text-text-secondary transition-colors cursor-pointer">
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
          onclick={() => isAdding = true}
          class="flex items-center gap-1.5 px-3 py-1.5 rounded-[5px] bg-bg-hover hover:bg-bg-hover-strong border border-border-subtle text-[12px] text-text-secondary hover:text-text-primary transition-colors mb-4 cursor-pointer"
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
        <div class="rounded-md border border-error-soft/30 bg-error-bg p-3 text-[12px] font-mono text-error-soft break-all">{loadError}</div>
      {:else if keys.length === 0}
        <div class="flex flex-col items-center justify-center py-16 text-center">
          <div class="w-11 h-11 rounded-md bg-bg-surface border border-border-subtle flex items-center justify-center mb-3">
            <KeyRound class="w-5 h-5 text-text-placeholder" />
          </div>
          <p class="text-[14px] text-text-tertiary">No SSH keys</p>
          <p class="text-[12px] text-text-placeholder mt-1">Add an SSH key to push to your workspace repositories</p>
        </div>
      {:else}
        <div class="space-y-2">
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
