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
let username = $state("");
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
		username = authStore.profile?.username ?? "";
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
			username: username.trim() || null,
		});
		displayName = profile.displayName;
		avatarUrl = profile.avatarUrl ?? "";
		username = profile.username ?? "";
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

<svelte:head>
	<title>Profile — Cohub</title>
</svelte:head>

<div class="flex-1 flex flex-col min-h-0 overflow-y-auto">
	<div class="flex-1 overflow-y-auto px-6 py-7">
		<section class="max-w-2xl">
			<div class="border-b border-border-subtle pb-5">
				<h1 class="text-[18px] font-semibold text-text-primary tracking-tight">Profile</h1>
				<p class="mt-1 max-w-xl text-[13px] leading-5 text-text-tertiary">
					Manage the identity Cohub shows in shared spaces and agent activity.
				</p>
			</div>

			{#if loadError}
				<div class="mt-6 rounded-md border border-error-soft/30 bg-error-bg p-3 text-[12px] font-mono text-error-soft break-all">{loadError}</div>
			{:else if userUuid}
				<div class="py-6">
					<div class="flex items-center gap-3">
						{#if avatarUrl}
							<img src={avatarUrl} alt="avatar" class="w-11 h-11 rounded-full border border-border-subtle object-cover" />
						{:else}
							<div class="w-11 h-11 rounded-full bg-bg-hover-strong border border-border-subtle flex items-center justify-center">
								<User class="w-4 h-4 text-text-tertiary" />
							</div>
						{/if}
						<div class="min-w-0">
							<div class="truncate text-[15px] font-medium text-text-primary">{displayName || username || "User"}</div>
							<div class="mt-0.5 text-[12px] text-text-tertiary">{username ? `@${username}` : "Public profile"}</div>
						</div>
					</div>

					<div class="mt-6 space-y-4">
						<label class="block">
							<div class="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-text-tertiary">Username</div>
							<div class="flex items-center rounded-[5px] border border-border-subtle bg-bg-input px-3 py-2 transition-colors focus-within:border-brand/40">
								<span class="mr-1 shrink-0 text-[13px] text-text-tertiary">@</span>
								<input bind:value={username} placeholder="your-handle" maxlength="39" class="w-full bg-transparent text-[13px] text-text-primary placeholder:text-text-placeholder focus:outline-none" />
							</div>
							<p class="mt-1.5 text-[11px] leading-4 text-text-tertiary">Lowercase letters, numbers, and hyphens only. This will be used in public URLs.</p>
						</label>

						<label class="block">
							<div class="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-text-tertiary">Display name</div>
							<input bind:value={displayName} maxlength="120" class="w-full rounded-[5px] border border-border-subtle bg-bg-input px-3 py-2 text-[13px] text-text-primary transition-colors focus:border-brand/40 focus:outline-none" />
						</label>

						<label class="block">
							<div class="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-text-tertiary">Avatar URL</div>
							<input bind:value={avatarUrl} placeholder="https://..." class="w-full rounded-[5px] border border-border-subtle bg-bg-input px-3 py-2 text-[13px] text-text-primary placeholder:text-text-placeholder transition-colors focus:border-brand/40 focus:outline-none" />
						</label>
					</div>

					{#if saveError}
						<div class="mt-4 rounded-md border border-error-soft/30 bg-error-bg p-3 text-[12px] text-error-soft break-all">{saveError}</div>
					{/if}

					<div class="mt-5 flex items-center justify-between gap-3">
						<button type="button" onclick={saveProfile} disabled={saving || !displayName.trim()} class="inline-flex items-center gap-1.5 rounded-[5px] bg-brand px-3 py-1.5 text-[12px] font-medium text-brand-contrast-fg transition-colors hover:bg-brand-hover disabled:opacity-50">
							{#if saving}<Loader2 class="w-3.5 h-3.5 animate-spin" />{:else if saved}<Check class="w-3.5 h-3.5" />{/if}
							{saved ? "Saved" : "Save"}
						</button>
					</div>

					<div class="mt-8 border-t border-border-subtle pt-5">
						<div class="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-text-tertiary">User UUID</div>
						<div class="flex items-center gap-2">
							<code class="flex-1 rounded-[5px] bg-bg-code px-3 py-[7px] text-[12px] font-mono text-text-secondary truncate select-all">{userUuid}</code>
							<button type="button" onclick={copyUuid} class="shrink-0 p-2 rounded-[5px] text-text-tertiary hover:bg-bg-hover hover:text-text-secondary transition-colors cursor-pointer" title="Copy UUID">
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

			<section class="border-t border-border-subtle py-6">
				<div>
					<h2 class="text-[14px] font-medium text-text-primary">Theme</h2>
					<p class="mt-1 text-[12px] leading-5 text-text-tertiary">Choose how Cohub looks on this device.</p>
				</div>

				<div class="mt-4 grid gap-2 sm:grid-cols-3">
					{#each themeOptions as option (option.value)}
						{@const active = isThemeActive(option.value)}
						<button
							type="button"
							class="group flex min-w-0 items-center gap-2 rounded-[6px] px-3 py-2.5 text-left transition-colors duration-100 {active ? 'bg-brand-bg text-text-primary' : 'text-text-tertiary hover:bg-bg-hover hover:text-text-secondary'}"
							onclick={() => handleThemeChange(option.value)}
						>
							<span class="flex h-7 w-7 shrink-0 items-center justify-center rounded-[5px] {active ? 'bg-brand/15 text-brand' : 'bg-bg-hover-strong text-text-tertiary group-hover:text-text-secondary'}">
								<option.icon class="w-3.5 h-3.5" />
							</span>
							<span class="min-w-0">
								<span class="block text-[12px] font-medium">{option.label}</span>
								<span class="block truncate text-[10px] text-text-tertiary">{option.description}</span>
							</span>
						</button>
					{/each}
				</div>
			</section>
		</section>
	</div>
</div>
