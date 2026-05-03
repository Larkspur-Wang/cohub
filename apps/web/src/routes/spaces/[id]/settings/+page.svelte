<script lang="ts">
import type {
	Channel,
	SpaceAccessPolicy,
	SpaceChannelBindingRecord,
	SpaceEnvInput,
	SpaceMember,
	SpaceRecord,
	SpaceRole,
} from "@neta-art/cohub";
import {
	ArrowLeft,
	Globe,
	Loader2,
	Network,
	RefreshCw,
	Settings,
	Terminal,
	User,
	Users,
} from "lucide-svelte";
import { goto } from "$app/navigation";
import { sdk } from "$lib/sdk";

type SandboxInfo = {
	status: string | null;
	desiredImage?: string | null;
	reportedImageVersion?: string | null;
	lastHeartbeatAt?: string | null;
	reportedAt?: string | null;
	meta?: Record<string, unknown> | null;
};

const props = $props<{ data: { spaceId: string } }>();
const spaceId = $derived(props.data.spaceId);

let space = $state<SpaceRecord | null>(null);
let access = $state<SpaceAccessPolicy | null>(null);
let members = $state<SpaceMember[]>([]);
let env = $state<SpaceEnvInput[]>([]);
let channels = $state<SpaceChannelBindingRecord[]>([]);
let sandbox = $state<SandboxInfo | null>(null);
let allChannels = $state<Channel[]>([]);
let loading = $state(true);
let error = $state("");
let saving = $state(false);
let description = $state("");
let pictureUrl = $state("");
let envName = $state("");
let envValue = $state("");
let selectedChannelId = $state("");
let revealedEnvNames = $state<Set<string>>(new Set());
let recoveringSandbox = $state(false);
let sandboxRecoveryMessage = $state("");
let sandboxRecoveryError = $state("");

function getPictureUrl(record: SpaceRecord | null): string {
	const meta = record?.meta;
	if (!meta || typeof meta !== "object" || Array.isArray(meta)) return "";
	const profile = (meta as Record<string, unknown>).publicProfile;
	if (!profile || typeof profile !== "object" || Array.isArray(profile))
		return "";
	const raw = (profile as Record<string, unknown>).pictureUrl;
	return typeof raw === "string" ? raw : "";
}

function getSandboxMetaValue(key: string): string {
	const meta = sandbox?.meta;
	if (!meta || typeof meta !== "object") return "";
	const value = meta[key];
	return typeof value === "string" ? value : "";
}

function formatTime(value?: string | null): string {
	if (!value) return "—";
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return "—";
	return date.toLocaleString();
}

async function loadSandbox() {
	const result = await sdk
		.space(spaceId)
		.sandbox.get()
		.catch(() => null);
	sandbox = result?.sandbox ?? null;
}

async function forceRecoverSandbox() {
	if (recoveringSandbox) return;
	const confirmed = window.confirm(
		"Force recovery will recreate the Sandbox and stop any running processes. Workspace files will be preserved. Continue?",
	);
	if (!confirmed) return;
	recoveringSandbox = true;
	sandboxRecoveryMessage = "";
	sandboxRecoveryError = "";
	try {
		const result = await sdk.space(spaceId).sandbox.recreate();
		sandboxRecoveryMessage = result.verified
			? "Sandbox recovered and verified."
			: "Sandbox recovery completed.";
		await loadSandbox();
	} catch (err) {
		sandboxRecoveryError =
			err instanceof Error ? err.message : "Sandbox recovery failed";
	} finally {
		recoveringSandbox = false;
	}
}

async function loadPage() {
	loading = true;
	error = "";
	try {
		const [
			spaceResult,
			accessResult,
			memberResult,
			envResult,
			channelResult,
			allChannelResult,
			sandboxResult,
		] = await Promise.all([
			sdk.space(spaceId).get(),
			sdk
				.space(spaceId)
				.access.get()
				.catch(() => null),
			sdk
				.space(spaceId)
				.members.list()
				.catch(() => ({ items: [] })),
			sdk
				.space(spaceId)
				.env.list()
				.catch(() => ({ env: [] })),
			sdk
				.space(spaceId)
				.channels.list()
				.catch(() => []),
			sdk.channels.list().catch(() => []),
			sdk
				.space(spaceId)
				.sandbox.get()
				.catch(() => null),
		]);
		space = spaceResult;
		access = accessResult;
		members = memberResult.items;
		env = envResult.env;
		channels = channelResult;
		allChannels = allChannelResult;
		sandbox = sandboxResult?.sandbox ?? null;
		description = spaceResult.description ?? "";
		pictureUrl = getPictureUrl(spaceResult);
	} catch (err) {
		error = err instanceof Error ? err.message : "Failed to load settings";
	} finally {
		loading = false;
	}
}

async function saveProfile() {
	saving = true;
	try {
		const result = await sdk
			.space(spaceId)
			.profile({ description, pictureUrl });
		space = result.space;
	} finally {
		saving = false;
	}
}

async function setAccess(body: {
	signed_in_user?: SpaceRole | null;
	anonymous_user?: SpaceRole | null;
}) {
	access = await sdk.space(spaceId).access.set(body);
}

async function addEnv() {
	if (!envName.trim()) return;
	const result = await sdk
		.space(spaceId)
		.env.create({ name: envName.trim(), value: envValue });
	env = result.env;
	envName = "";
	envValue = "";
}

async function removeEnv(name: string) {
	const result = await sdk.space(spaceId).env.remove(name);
	env = result.env;
}

function toggleEnvReveal(name: string) {
	const next = new Set(revealedEnvNames);
	if (next.has(name)) next.delete(name);
	else next.add(name);
	revealedEnvNames = next;
}

async function bindChannel() {
	if (!selectedChannelId) return;
	await sdk.space(spaceId).channels.bind(selectedChannelId);
	channels = await sdk.space(spaceId).channels.list();
	selectedChannelId = "";
}

async function unbindChannel(channelId: string) {
	await sdk.space(spaceId).channels.unbind(channelId);
	channels = await sdk.space(spaceId).channels.list();
}

$effect(() => {
	void loadPage();
});
</script>

<svelte:head><title>Space settings — Cohub</title></svelte:head>

<div class="flex-1 flex flex-col min-h-0 overflow-y-auto">
	<div class="h-[40px] flex items-center justify-between px-4 border-b border-border-subtle shrink-0 bg-bg-primary">
		<div class="flex items-center gap-3 min-w-0">
			<button type="button" class="text-text-tertiary hover:text-text-primary transition-colors" onclick={() => goto(`/spaces/${spaceId}`)}><ArrowLeft class="w-4 h-4" /></button>
			<div class="w-px h-4 bg-border-subtle"></div>
			<span class="text-[11px] font-medium text-text-secondary">Space settings</span>
		</div>
	</div>

	<div class="flex-1 overflow-y-auto p-5">
		<div class="mx-auto max-w-3xl space-y-4">
			{#if loading}
				<div class="flex items-center gap-2 text-[13px] text-text-tertiary"><Loader2 class="w-4 h-4 animate-spin" /> Loading settings…</div>
			{:else if error}
				<div class="rounded-md border border-error-soft/30 bg-error-bg p-3 text-[12px] text-error-soft">{error}</div>
			{:else}
				<section class="rounded-[10px] border border-border-subtle bg-bg-surface p-4 space-y-3">
					<div class="flex items-center gap-2"><User class="w-4 h-4 text-text-tertiary" /><div><div class="text-[11px] uppercase tracking-[0.16em] text-text-placeholder">Profile</div><div class="text-[15px] font-medium text-text-primary">Public space details</div></div></div>
					<input bind:value={pictureUrl} placeholder="Picture URL" class="w-full px-3 py-2 rounded-[5px] bg-bg-input border border-border-subtle text-[13px] text-text-primary placeholder:text-text-placeholder focus:border-brand/40 focus:outline-none" />
					<textarea bind:value={description} rows="4" placeholder="Description" class="w-full px-3 py-2 rounded-[5px] bg-bg-input border border-border-subtle text-[13px] text-text-primary placeholder:text-text-placeholder focus:border-brand/40 focus:outline-none resize-y"></textarea>
					<div class="flex justify-end"><button type="button" onclick={saveProfile} disabled={saving} class="px-3 py-2 rounded-[5px] bg-brand text-white text-[12px] font-medium disabled:opacity-50">Save profile</button></div>
				</section>

				<section class="rounded-[10px] border border-border-subtle bg-bg-surface p-4 space-y-3">
					<div class="flex items-center gap-2"><Globe class="w-4 h-4 text-text-tertiary" /><div><div class="text-[11px] uppercase tracking-[0.16em] text-text-placeholder">Sharing</div><div class="text-[15px] font-medium text-text-primary">Space access</div></div></div>
					<div class="flex items-center justify-between"><span class="text-[13px] text-text-secondary">Signed-in users</span><select value={access?.signed_in_user ?? ""} onchange={(e) => { const value = (e.currentTarget as HTMLSelectElement).value as SpaceRole | ""; void setAccess({ signed_in_user: value || null }); }} class="px-2 py-1 rounded bg-bg-input border border-border-subtle text-[12px]"><option value="">None</option><option value="guest">Guest</option><option value="builder">Builder</option></select></div>
					<div class="flex items-center justify-between"><span class="text-[13px] text-text-secondary">Anonymous</span><select value={access?.anonymous_user ?? ""} onchange={(e) => { const value = (e.currentTarget as HTMLSelectElement).value as SpaceRole | ""; void setAccess({ anonymous_user: value || null }); }} class="px-2 py-1 rounded bg-bg-input border border-border-subtle text-[12px]"><option value="">None</option><option value="guest">Guest</option></select></div>
				</section>

				<section class="rounded-[10px] border border-border-subtle bg-bg-surface p-4 space-y-3">
					<div class="flex items-center gap-2"><Users class="w-4 h-4 text-text-tertiary" /><div><div class="text-[11px] uppercase tracking-[0.16em] text-text-placeholder">Members</div><div class="text-[15px] font-medium text-text-primary">{members.length} member{members.length !== 1 ? 's' : ''}</div></div></div>
					<div class="space-y-1">{#each members as member (member.userId)}<div class="flex items-center justify-between rounded-[5px] bg-bg-primary px-3 py-2"><code class="text-[11px] text-text-secondary truncate">{member.userId}</code><span class="text-[10px] uppercase tracking-wider text-text-placeholder">{member.role}</span></div>{/each}</div>
				</section>

				<section class="rounded-[10px] border border-border-subtle bg-bg-surface p-4 space-y-3">
					<div class="flex items-center gap-2"><Terminal class="w-4 h-4 text-text-tertiary" /><div><div class="text-[11px] uppercase tracking-[0.16em] text-text-placeholder">Env</div><div class="text-[15px] font-medium text-text-primary">Environment variables</div></div></div>
					<div class="flex gap-2"><input bind:value={envName} placeholder="NAME" class="w-40 px-2 py-1.5 rounded bg-bg-input border border-border-subtle text-[12px] font-mono" /><input bind:value={envValue} placeholder="value" class="flex-1 px-2 py-1.5 rounded bg-bg-input border border-border-subtle text-[12px] font-mono" /><button type="button" onclick={addEnv} class="px-3 py-1.5 rounded bg-brand text-white text-[12px]">Add</button></div>
					<div class="space-y-1">{#each env as item (item.name)}<div class="flex items-center gap-2 rounded-[5px] bg-bg-primary px-3 py-2"><code class="w-40 text-[11px] text-text-primary">{item.name}</code><code class="flex-1 truncate text-[11px] text-text-tertiary">{revealedEnvNames.has(item.name) ? item.value : '••••••••'}</code><button type="button" onclick={() => toggleEnvReveal(item.name)} class="text-[11px] text-text-placeholder hover:text-text-secondary">{revealedEnvNames.has(item.name) ? 'Hide' : 'Reveal'}</button><button type="button" onclick={() => removeEnv(item.name)} class="text-[11px] text-text-placeholder hover:text-error-soft">Remove</button></div>{/each}</div>
				</section>

				<section class="rounded-[10px] border border-border-subtle bg-bg-surface p-4 space-y-3">
					<div class="flex items-center gap-2"><Network class="w-4 h-4 text-text-tertiary" /><div><div class="text-[11px] uppercase tracking-[0.16em] text-text-placeholder">Channels</div><div class="text-[15px] font-medium text-text-primary">Bound channels</div></div></div>
					<div class="flex gap-2"><select bind:value={selectedChannelId} class="flex-1 px-2 py-1.5 rounded bg-bg-input border border-border-subtle text-[12px]"><option value="">Select channel</option>{#each allChannels.filter((ch) => !channels.some((binding) => binding.channelId === ch.id)) as channel (channel.id)}<option value={channel.id}>{channel.provider} · {channel.name}</option>{/each}</select><button type="button" onclick={bindChannel} class="px-3 py-1.5 rounded bg-brand text-white text-[12px]">Bind</button></div>
					<div class="space-y-1">{#each channels as binding (binding.id)}<div class="flex items-center justify-between rounded-[5px] bg-bg-primary px-3 py-2"><span class="text-[12px] text-text-secondary">{binding.channel?.provider ?? 'channel'} · {binding.channel?.name ?? binding.channelId}</span><button type="button" onclick={() => unbindChannel(binding.channelId)} class="text-[11px] text-text-placeholder hover:text-error-soft">Unbind</button></div>{/each}</div>
				</section>

				<section class="rounded-[10px] border border-border-subtle bg-bg-surface p-4 space-y-3">
					<div class="flex items-center justify-between gap-3">
						<div class="flex items-center gap-2"><Settings class="w-4 h-4 text-text-tertiary" /><div><div class="text-[11px] uppercase tracking-[0.16em] text-text-placeholder">Sandbox</div><div class="text-[15px] font-medium text-text-primary">Runtime health</div></div></div>
						<button type="button" onclick={forceRecoverSandbox} disabled={recoveringSandbox} class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[5px] bg-bg-input border border-border-subtle text-[12px] text-text-secondary hover:text-text-primary disabled:opacity-50">
							{#if recoveringSandbox}<Loader2 class="w-3.5 h-3.5 animate-spin" /> Recovering{:else}<RefreshCw class="w-3.5 h-3.5" /> Force recover{/if}
						</button>
					</div>
					<div class="grid grid-cols-2 gap-2 text-[12px]">
						<div class="rounded-[5px] bg-bg-primary px-3 py-2"><div class="text-text-placeholder">Status</div><div class="mt-0.5 text-text-primary">{sandbox?.status ?? '—'}</div></div>
						<div class="rounded-[5px] bg-bg-primary px-3 py-2"><div class="text-text-placeholder">Last heartbeat</div><div class="mt-0.5 text-text-primary">{formatTime(sandbox?.lastHeartbeatAt)}</div></div>
						<div class="rounded-[5px] bg-bg-primary px-3 py-2"><div class="text-text-placeholder">Desired image</div><div class="mt-0.5 truncate font-mono text-[11px] text-text-primary">{sandbox?.desiredImage ?? '—'}</div></div>
						<div class="rounded-[5px] bg-bg-primary px-3 py-2"><div class="text-text-placeholder">Reported image</div><div class="mt-0.5 truncate font-mono text-[11px] text-text-primary">{(sandbox?.reportedImageVersion ?? getSandboxMetaValue('imageVersion')) || '—'}</div></div>
					</div>
					<p class="text-[11px] leading-relaxed text-text-tertiary">Force recover will recreate the Sandbox from the current template, so it also picks up the currently configured Sandbox image. Workspace files are preserved, but running processes will stop.</p>
					{#if sandboxRecoveryMessage}<div class="rounded-[5px] border border-success-soft/30 bg-success-bg px-3 py-2 text-[12px] text-success-soft">{sandboxRecoveryMessage}</div>{/if}
					{#if sandboxRecoveryError}<div class="rounded-[5px] border border-error-soft/30 bg-error-bg px-3 py-2 text-[12px] text-error-soft">{sandboxRecoveryError}</div>{/if}
				</section>
			{/if}
		</div>
	</div>
</div>
