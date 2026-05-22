<script lang="ts">
import {
	Check,
	Copy,
	Loader2,
	Monitor,
	Moon,
	Pencil,
	Sun,
	User,
	X,
} from "lucide-svelte";
import { onMount } from "svelte";
import { page } from "$app/state";
import { ensureAuth } from "$lib/auth";
import { handleUnauthorizedError } from "$lib/auth-redirect";
import { isComposingKeyboardEvent } from "$lib/keyboard";
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

type EditableField = "displayName" | "username" | "avatarUrl";

let userUuid = $state("");
let displayName = $state("");
let avatarUrl = $state("");
let username = $state("");
let uuidCopied = $state(false);
let loadError = $state("");
let inlineError = $state("");
let profileLoading = $state(true);
let editingField = $state<EditableField | null>(null);
let draftValue = $state("");
let savingField = $state<EditableField | null>(null);
let uuidCopiedTimer: ReturnType<typeof setTimeout> | null = null;

const profileTitle = $derived(displayName || username || "User");
const usernameLabel = $derived(username ? `@${username}` : "Public profile");
const uuidLabel = $derived(formatUuid(userUuid));

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

function formatUuid(uuid: string): string {
	if (!uuid) return "";
	if (uuid.length <= 13) return uuid;
	return `${uuid.slice(0, 8)}…${uuid.slice(-4)}`;
}

function getFieldValue(field: EditableField): string {
	if (field === "displayName") return displayName;
	if (field === "username") return username;
	return avatarUrl;
}

function beginEdit(field: EditableField) {
	if (profileLoading || savingField) return;
	inlineError = "";
	editingField = field;
	draftValue = getFieldValue(field);
}

function cancelEdit() {
	if (savingField) return;
	editingField = null;
	draftValue = "";
	inlineError = "";
}

function handleEditKeydown(event: KeyboardEvent) {
	if (event.key === "Escape") {
		event.preventDefault();
		cancelEdit();
		return;
	}
	if (event.key === "Enter" && !isComposingKeyboardEvent(event)) {
		event.preventDefault();
		void saveEditingField();
	}
}

async function loadProfile() {
	profileLoading = true;
	loadError = "";
	if (!(await ensureAuth({ redirectPath: `${currentPath}${currentSearch}` }))) {
		profileLoading = false;
		return;
	}
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
	} finally {
		profileLoading = false;
	}
}

async function saveEditingField() {
	if (!editingField || savingField) return;

	const field = editingField;
	const nextDisplayName =
		field === "displayName" ? draftValue.trim() : displayName.trim();
	const nextUsername =
		field === "username" ? draftValue.trim() : username.trim();
	const nextAvatarUrl =
		field === "avatarUrl" ? draftValue.trim() : avatarUrl.trim();

	inlineError = "";
	if (!nextDisplayName) {
		inlineError = "Display name is required.";
		return;
	}

	savingField = field;
	try {
		const profile = await authStore.updateProfile({
			displayName: nextDisplayName,
			avatarUrl: nextAvatarUrl || null,
			username: nextUsername || null,
		});
		displayName = profile.displayName;
		avatarUrl = profile.avatarUrl ?? "";
		username = profile.username ?? "";
		editingField = null;
		draftValue = "";
	} catch (error) {
		inlineError =
			error instanceof Error ? error.message : "Failed to save profile";
	} finally {
		savingField = null;
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
			{:else}
				<div class="py-6">
					<div class="flex items-start gap-3">
						{#if profileLoading}
							<div class="w-11 h-11 shrink-0 rounded-full border border-border-subtle bg-bg-hover-strong" aria-hidden="true"></div>
						{:else if avatarUrl}
							<img src={avatarUrl} alt="avatar" class="w-11 h-11 shrink-0 rounded-full border border-border-subtle object-cover" />
						{:else}
							<div class="w-11 h-11 shrink-0 rounded-full bg-bg-hover-strong border border-border-subtle flex items-center justify-center">
								<User class="w-4 h-4 text-text-tertiary" />
							</div>
						{/if}
						<div class="min-w-0 flex-1 pt-0.5">
							{#if profileLoading}
								<div class="h-4 w-32 rounded bg-bg-hover-strong" aria-hidden="true"></div>
								<div class="mt-2 h-3 w-20 rounded bg-bg-hover-strong" aria-hidden="true"></div>
								<div class="mt-2 h-3 w-36 rounded bg-bg-hover-strong" aria-hidden="true"></div>
							{:else}
								<div class="flex min-w-0 items-center gap-2">
									<button type="button" onclick={() => beginEdit("displayName")} class="min-w-0 truncate text-left text-[15px] font-medium text-text-primary transition-colors hover:text-brand" title="Edit display name">
										{profileTitle}
									</button>
									<button type="button" onclick={() => beginEdit("displayName")} class="shrink-0 rounded-[4px] p-1 text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-secondary" title="Edit display name">
										<Pencil class="w-3 h-3" />
									</button>
								</div>
								<button type="button" onclick={() => beginEdit("username")} class="mt-0.5 block max-w-full truncate text-left text-[12px] text-text-tertiary transition-colors hover:text-text-secondary" title="Edit username">
									{usernameLabel}
								</button>
								<div class="mt-1 flex min-w-0 items-center gap-1.5 text-[11px] text-text-tertiary">
									<span class="shrink-0 uppercase tracking-wider">ID</span>
									<code class="min-w-0 truncate font-mono" title={userUuid}>{uuidLabel}</code>
									<button type="button" onclick={copyUuid} class="shrink-0 rounded-[4px] p-1 text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-secondary" title="Copy UUID">
										{#if uuidCopied}
											<Check class="w-3 h-3 text-status-running" />
										{:else}
											<Copy class="w-3 h-3" />
										{/if}
									</button>
								</div>
							{/if}
						</div>
					</div>

					<div class="mt-5 divide-y divide-border-subtle border-y border-border-subtle">
						<div class="grid min-h-11 grid-cols-[96px_minmax(0,1fr)] items-center gap-3 py-2">
							<div class="text-[10px] font-medium uppercase tracking-wider text-text-tertiary">Display name</div>
							{#if profileLoading}
								<div class="h-3.5 w-40 rounded bg-bg-hover-strong" aria-hidden="true"></div>
							{:else if editingField === "displayName"}
								<div class="flex min-w-0 items-center gap-2">
									<input bind:value={draftValue} maxlength="120" onkeydown={handleEditKeydown} disabled={savingField === "displayName"} class="min-w-0 flex-1 rounded-[5px] border border-brand/40 bg-bg-input px-2.5 py-1.5 text-[13px] text-text-primary transition-colors focus:outline-none" />
									<button type="button" onclick={() => void saveEditingField()} disabled={savingField === "displayName"} class="shrink-0 rounded-[5px] p-1.5 text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-secondary disabled:opacity-50" title="Save display name">
										{#if savingField === "displayName"}<Loader2 class="w-3.5 h-3.5 animate-spin" />{:else}<Check class="w-3.5 h-3.5" />{/if}
									</button>
									<button type="button" onclick={cancelEdit} disabled={savingField === "displayName"} class="shrink-0 rounded-[5px] p-1.5 text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-secondary disabled:opacity-50" title="Cancel">
										<X class="w-3.5 h-3.5" />
									</button>
								</div>
							{:else}
								<button type="button" onclick={() => beginEdit("displayName")} class="flex min-w-0 items-center justify-between gap-3 rounded-[5px] px-1 py-1 text-left transition-colors hover:bg-bg-hover">
									<span class="min-w-0 truncate text-[13px] text-text-primary">{displayName}</span>
									<Pencil class="w-3 h-3 shrink-0 text-text-tertiary" />
								</button>
							{/if}
						</div>

						<div class="grid min-h-11 grid-cols-[96px_minmax(0,1fr)] items-center gap-3 py-2">
							<div>
								<div class="text-[10px] font-medium uppercase tracking-wider text-text-tertiary">Username</div>
							</div>
							{#if profileLoading}
								<div class="h-3.5 w-32 rounded bg-bg-hover-strong" aria-hidden="true"></div>
							{:else if editingField === "username"}
								<div class="min-w-0">
									<div class="flex min-w-0 items-center gap-2">
										<div class="flex min-w-0 flex-1 items-center rounded-[5px] border border-brand/40 bg-bg-input px-2.5 py-1.5">
											<span class="mr-1 shrink-0 text-[13px] text-text-tertiary">@</span>
											<input bind:value={draftValue} placeholder="your-handle" maxlength="39" onkeydown={handleEditKeydown} disabled={savingField === "username"} class="min-w-0 flex-1 bg-transparent text-[13px] text-text-primary placeholder:text-text-placeholder focus:outline-none" />
										</div>
										<button type="button" onclick={() => void saveEditingField()} disabled={savingField === "username"} class="shrink-0 rounded-[5px] p-1.5 text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-secondary disabled:opacity-50" title="Save username">
											{#if savingField === "username"}<Loader2 class="w-3.5 h-3.5 animate-spin" />{:else}<Check class="w-3.5 h-3.5" />{/if}
										</button>
										<button type="button" onclick={cancelEdit} disabled={savingField === "username"} class="shrink-0 rounded-[5px] p-1.5 text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-secondary disabled:opacity-50" title="Cancel">
											<X class="w-3.5 h-3.5" />
										</button>
									</div>
									<p class="mt-1.5 text-[11px] leading-4 text-text-tertiary">Lowercase letters, numbers, and hyphens only.</p>
								</div>
							{:else}
								<button type="button" onclick={() => beginEdit("username")} class="flex min-w-0 items-center justify-between gap-3 rounded-[5px] px-1 py-1 text-left transition-colors hover:bg-bg-hover">
									<span class="min-w-0 truncate text-[13px] {username ? 'text-text-primary' : 'text-text-placeholder'}">{username ? `@${username}` : "Not set"}</span>
									<Pencil class="w-3 h-3 shrink-0 text-text-tertiary" />
								</button>
							{/if}
						</div>

						<div class="grid min-h-11 grid-cols-[96px_minmax(0,1fr)] items-center gap-3 py-2">
							<div class="text-[10px] font-medium uppercase tracking-wider text-text-tertiary">Avatar URL</div>
							{#if profileLoading}
								<div class="h-3.5 w-56 rounded bg-bg-hover-strong" aria-hidden="true"></div>
							{:else if editingField === "avatarUrl"}
								<div class="flex min-w-0 items-center gap-2">
									<input bind:value={draftValue} placeholder="https://..." onkeydown={handleEditKeydown} disabled={savingField === "avatarUrl"} class="min-w-0 flex-1 rounded-[5px] border border-brand/40 bg-bg-input px-2.5 py-1.5 text-[13px] text-text-primary placeholder:text-text-placeholder transition-colors focus:outline-none" />
									<button type="button" onclick={() => void saveEditingField()} disabled={savingField === "avatarUrl"} class="shrink-0 rounded-[5px] p-1.5 text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-secondary disabled:opacity-50" title="Save avatar URL">
										{#if savingField === "avatarUrl"}<Loader2 class="w-3.5 h-3.5 animate-spin" />{:else}<Check class="w-3.5 h-3.5" />{/if}
									</button>
									<button type="button" onclick={cancelEdit} disabled={savingField === "avatarUrl"} class="shrink-0 rounded-[5px] p-1.5 text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-secondary disabled:opacity-50" title="Cancel">
										<X class="w-3.5 h-3.5" />
									</button>
								</div>
							{:else}
								<button type="button" onclick={() => beginEdit("avatarUrl")} class="flex min-w-0 items-center justify-between gap-3 rounded-[5px] px-1 py-1 text-left transition-colors hover:bg-bg-hover">
									<span class="min-w-0 truncate text-[13px] {avatarUrl ? 'text-text-primary' : 'text-text-placeholder'}">{avatarUrl || "Not set"}</span>
									<Pencil class="w-3 h-3 shrink-0 text-text-tertiary" />
								</button>
							{/if}
						</div>
					</div>

					{#if inlineError}
						<div class="mt-4 rounded-md border border-error-soft/30 bg-error-bg p-3 text-[12px] text-error-soft break-all">{inlineError}</div>
					{/if}
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
