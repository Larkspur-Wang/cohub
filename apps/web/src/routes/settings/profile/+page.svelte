<script lang="ts">
import { Check, Copy, Loader2, Monitor, Moon, Sun, User } from "lucide-svelte";
import { onMount } from "svelte";
import { page } from "$app/state";
import { ensureAuth } from "$lib/auth";
import { handleUnauthorizedError } from "$lib/auth-redirect";
import { authStore } from "$lib/stores/auth.svelte";
import {
	getResolvedTheme,
	getTheme,
	setTheme,
	type ThemeMode,
} from "$lib/theme.svelte";

const mode = $derived(getTheme());
const resolved = $derived(getResolvedTheme());
const currentPath = $derived(page.url.pathname);
const currentSearch = $derived(page.url.search);

let userUuid = $state("");
let displayName = $state("");
let avatarUrl = $state("");
let uuidCopied = $state(false);
let loadError = $state("");
let saveError = $state("");
let saving = $state(false);
let saved = $state(false);
let uuidCopiedTimer: ReturnType<typeof setTimeout> | null = null;
let savedTimer: ReturnType<typeof setTimeout> | null = null;

const themeOptions: {
	value: ThemeMode;
	label: string;
	icon: typeof Sun;
	description: string;
}[] = [
	{
		value: "dark",
		label: "Dark",
		icon: Moon,
		description: "Always use dark theme",
	},
	{
		value: "light",
		label: "Light",
		icon: Sun,
		description: "Always use light theme",
	},
	{
		value: "system",
		label: "System",
		icon: Monitor,
		description: "Follow your system preference",
	},
];

function handleThemeChange(mode: ThemeMode) {
	setTheme(mode);
}

function isThemeActive(option: ThemeMode): boolean {
	if (mode === option) return true;
	if (mode === "system" && resolved === option) return true;
	return false;
}

async function loadProfile() {
	if (!(await ensureAuth({ redirectPath: `${currentPath}${currentSearch}` })))
		return;
	try {
		await authStore.ensureLoaded(true);
		userUuid = authStore.userUuid ?? "";
		displayName = authStore.profile?.displayName ?? "";
		avatarUrl = authStore.profile?.avatarUrl ?? "";
	} catch (error) {
		if (
			await handleUnauthorizedError(error, `${currentPath}${currentSearch}`)
		) {
			return;
		}
		loadError =
			error instanceof Error ? error.message : "Failed to load profile";
		console.error("[profile] Failed to load profile:", error);
	}
}

async function saveProfile() {
	if (saving) return;
	saveError = "";
	saved = false;
	saving = true;
	try {
		const profile = await authStore.updateProfile({
			displayName: displayName.trim(),
			avatarUrl: avatarUrl.trim() || null,
		});
		displayName = profile.displayName;
		avatarUrl = profile.avatarUrl ?? "";
		saved = true;
		if (savedTimer) clearTimeout(savedTimer);
		savedTimer = setTimeout(() => {
			saved = false;
		}, 1800);
	} catch (error) {
		saveError =
			error instanceof Error ? error.message : "Failed to save profile";
	} finally {
		saving = false;
	}
}

async function copyUuid() {
	if (!userUuid) return;
	try {
		await navigator.clipboard.writeText(userUuid);
		uuidCopied = true;
		if (uuidCopiedTimer) clearTimeout(uuidCopiedTimer);
		uuidCopiedTimer = setTimeout(() => {
			uuidCopied = false;
		}, 2000);
	} catch {
		console.warn("[profile] Failed to copy UUID");
	}
}

onMount(() => {
	void loadProfile();
});
</script>

<div class="flex-1 flex flex-col min-h-0 overflow-y-auto">
  <div class="flex-1 p-6 overflow-y-auto">
    <section class="max-w-4xl">
      <h1 class="text-[18px] font-semibold text-text-primary tracking-tight">Profile</h1>
      <p class="mt-1 text-[13px] text-text-tertiary">
        Your public name and avatar are stored in Logto and cached in Cohub for display.
      </p>

      <div class="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_280px] xl:items-start">
        <div>
          {#if loadError}
            <div class="rounded-md border border-error-soft/30 bg-error-bg p-3 text-[12px] font-mono text-error-soft break-all">{loadError}</div>
          {:else if userUuid}
            <div class="border border-border-subtle rounded-md bg-bg-surface p-4 space-y-4">
                        <div class="flex items-center gap-3">
              {#if avatarUrl}
              <img src={avatarUrl} alt="avatar" class="w-10 h-10 rounded-full border border-border-subtle object-cover" />
                    {:else}
              <div class="w-10 h-10 rounded-full bg-bg-hover-strong border border-border-subtle flex items-center justify-center">
              <User class="w-4 h-4 text-text-tertiary" />
              </div>
                    {/if}
              <div class="min-w-0">
              <div class="truncate text-[14px] font-medium text-text-primary">{displayName || "User"}</div>
              <div class="text-[12px] text-text-tertiary">Public profile</div>
              </div>
              </div>

              <label class="block">
              <div class="block text-[10px] font-medium uppercase tracking-wider text-text-tertiary mb-1.5">Display name</div>
              <input bind:value={displayName} maxlength="120" class="w-full rounded-[5px] border border-border-subtle bg-bg-input px-3 py-2 text-[13px] text-text-primary focus:border-brand/40 focus:outline-none" />
              </label>

              <label class="block">
              <div class="block text-[10px] font-medium uppercase tracking-wider text-text-tertiary mb-1.5">Avatar URL</div>
              <input bind:value={avatarUrl} placeholder="https://..." class="w-full rounded-[5px] border border-border-subtle bg-bg-input px-3 py-2 text-[13px] text-text-primary placeholder:text-text-placeholder focus:border-brand/40 focus:outline-none" />
              </label>

              {#if saveError}
              <div class="rounded-md border border-error-soft/30 bg-error-bg p-3 text-[12px] text-error-soft break-all">{saveError}</div>
                    {/if}

              <div class="flex items-center justify-between gap-3">
              <button type="button" onclick={saveProfile} disabled={saving || !displayName.trim()} class="inline-flex items-center gap-1.5 rounded-[5px] bg-brand px-3 py-1.5 text-[12px] font-medium text-white transition-colors hover:bg-brand-hover disabled:opacity-50">
              {#if saving}<Loader2 class="w-3.5 h-3.5 animate-spin" />{:else if saved}<Check class="w-3.5 h-3.5" />{/if}
              {saved ? "Saved" : "Save"}
              </button>
              </div>

              <div>
                <div class="block text-[10px] font-medium uppercase tracking-wider text-text-tertiary mb-1.5">User UUID</div>
                <div class="flex items-center gap-2">
                  <code class="flex-1 px-3 py-[6px] rounded-[5px] bg-bg-code border border-border-subtle text-[12px] font-mono text-text-primary truncate select-all">{userUuid}</code>
                  <button
                    type="button"
                    onclick={copyUuid}
                    class="shrink-0 p-2 rounded-[5px] border border-border-subtle bg-bg-hover hover:bg-bg-hover-strong text-text-tertiary hover:text-text-secondary transition-colors cursor-pointer"
                    title="Copy UUID"
                  >
                    {#if uuidCopied}
                      <Check class="w-4 h-4 text-status-running" />
                    {:else}
                      <Copy class="w-4 h-4" />
                    {/if}
                  </button>
                </div>
              </div>
            </div>
          {/if}
        </div>

        <aside class="rounded-md border border-border-subtle bg-bg-surface p-3">
          <div class="text-[10px] font-medium uppercase tracking-wider text-text-tertiary">Appearance</div>
          <div class="mt-1 text-[12px] leading-5 text-text-tertiary">Choose how Cohub looks on this device.</div>
          <div class="mt-3 space-y-1.5">
            {#each themeOptions as option (option.value)}
              {@const active = isThemeActive(option.value)}
              <button
                type="button"
                class="w-full flex items-center gap-2 rounded-[5px] border px-2.5 py-2 text-left transition-colors duration-100 {active ? 'border-brand/40 bg-brand-bg' : 'border-border-subtle bg-bg-hover hover:bg-bg-hover-strong'}"
                onclick={() => handleThemeChange(option.value)}
              >
                <option.icon class="w-3.5 h-3.5 shrink-0 {active ? 'text-brand' : 'text-text-tertiary'}" />
                <div class="min-w-0 flex-1">
                  <div class="text-[12px] font-medium {active ? 'text-text-primary' : 'text-text-secondary'}">{option.label}</div>
                  <div class="text-[10px] text-text-tertiary truncate">{option.description}</div>
                </div>
              </button>
            {/each}
          </div>
        </aside>
      </div>
    </section>
  </div>
</div>
