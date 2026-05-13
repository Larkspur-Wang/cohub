<script lang="ts">
import type {
	Channel,
	SpaceAccessPolicy,
	SpaceChannelBindingRecord,
	SpaceEnvInput,
	SpaceInvitation,
	SpaceMember,
	SpaceRecord,
	SpaceRole,
} from "@neta-art/cohub";
import {
	ArrowLeft,
	Check,
	Copy,
	Eye,
	Globe,
	Link,
	Loader2,
	Network,
	Pencil,
	Plus,
	RefreshCw,
	Settings,
	Terminal,
	Trash2,
	User,
	Users,
	X,
} from "lucide-svelte";
import { onDestroy } from "svelte";
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
let invitations = $state<SpaceInvitation[]>([]);
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
let addingMemberUuid = $state("");
let addingMemberRole = $state<SpaceRole>("guest");
let savingMember = $state(false);
let addingMemberError = $state("");
let updatingMemberUserId = $state<string | null>(null);
let removingMemberUserId = $state<string | null>(null);
let loadingInvitations = $state(false);
let invitationsError = $state("");
let showInvitePanel = $state(false);
let inviteRole = $state<SpaceRole>("builder");
let inviteTtlDays = $state(7);
let inviteMaxUses = $state(0);
let creatingInvite = $state(false);
let inviteCreateError = $state("");
let copiedInviteToken = $state<string | null>(null);
let copiedInviteTimer: ReturnType<typeof setTimeout> | null = null;
let recoveringSandbox = $state(false);
let sandboxRecoveryMessage = $state("");
let sandboxRecoveryError = $state("");

onDestroy(() => {
	if (copiedInviteTimer) clearTimeout(copiedInviteTimer);
});

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
			invitationResult,
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
			sdk
				.space(spaceId)
				.invitations.list()
				.catch(() => ({ items: [] })),
		]);
		space = spaceResult;
		access = accessResult;
		members = memberResult.items;
		env = envResult.env;
		channels = channelResult;
		allChannels = allChannelResult;
		sandbox = sandboxResult?.sandbox ?? null;
		invitations = invitationResult.items;
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

function formatInviteExpiry(seconds: number | null): string {
	if (seconds === null) return "No expiry";
	if (seconds < 60) return "Expires in <1m";
	if (seconds < 3600) return `Expires in ${Math.ceil(seconds / 60)}m`;
	if (seconds < 86400) return `Expires in ${Math.ceil(seconds / 3600)}h`;
	return `Expires in ${Math.ceil(seconds / 86400)}d`;
}

async function loadMembers() {
	const result = await sdk.space(spaceId).members.list();
	members = result.items;
}

async function addMember() {
	if (!addingMemberUuid.trim() || savingMember) return;
	savingMember = true;
	addingMemberError = "";
	try {
		await sdk
			.space(spaceId)
			.members.update(addingMemberUuid.trim(), addingMemberRole);
		addingMemberUuid = "";
		await loadMembers();
	} catch (err) {
		addingMemberError =
			err instanceof Error ? err.message : "Failed to add member";
	} finally {
		savingMember = false;
	}
}

function getMemberDisplayName(member: SpaceMember): string {
	return member.profile?.displayName?.trim() || "User";
}

function getInitials(name: string): string {
	const words = name.trim().split(/\s+/).filter(Boolean);
	const initials = words
		.slice(0, 2)
		.map((word) => word[0]?.toUpperCase() ?? "")
		.join("");
	return initials || "U";
}

function getMemberRoleIcon(role: SpaceRole) {
	if (role === "host") return "👑";
	return null;
}

async function updateMemberRole(userId: string, role: SpaceRole) {
	updatingMemberUserId = userId;
	addingMemberError = "";
	try {
		await sdk.space(spaceId).members.update(userId, role);
		await loadMembers();
	} catch (err) {
		addingMemberError =
			err instanceof Error ? err.message : "Failed to update member";
	} finally {
		updatingMemberUserId = null;
	}
}

async function removeMember(userId: string) {
	if (!window.confirm("Remove this member from the space?")) return;
	removingMemberUserId = userId;
	addingMemberError = "";
	try {
		await sdk.space(spaceId).members.remove(userId);
		await loadMembers();
	} catch (err) {
		addingMemberError =
			err instanceof Error ? err.message : "Failed to remove member";
	} finally {
		removingMemberUserId = null;
	}
}

async function loadInvitations() {
	loadingInvitations = true;
	invitationsError = "";
	try {
		const result = await sdk.space(spaceId).invitations.list();
		invitations = result.items;
	} catch (err) {
		invitationsError =
			err instanceof Error ? err.message : "Failed to load invitations";
	} finally {
		loadingInvitations = false;
	}
}

async function createInvite() {
	if (creatingInvite) return;
	if (inviteMaxUses < 0 || inviteMaxUses > 10000) {
		inviteCreateError = "Max uses must be between 0 and 10000";
		return;
	}
	creatingInvite = true;
	inviteCreateError = "";
	try {
		await sdk.space(spaceId).invitations.create({
			role: inviteRole,
			ttlSeconds: inviteTtlDays * 24 * 60 * 60,
			maxUses: inviteMaxUses || undefined,
		});
		showInvitePanel = false;
		await loadInvitations();
	} catch (err) {
		inviteCreateError =
			err instanceof Error ? err.message : "Failed to create invitation";
	} finally {
		creatingInvite = false;
	}
}

async function copyInviteLink(token: string) {
	try {
		const url = `${window.location.origin}/invite/${token}`;
		await navigator.clipboard.writeText(url);
		copiedInviteToken = token;
		if (copiedInviteTimer) clearTimeout(copiedInviteTimer);
		copiedInviteTimer = setTimeout(() => {
			copiedInviteToken = null;
		}, 2000);
	} catch {
		invitationsError = "Failed to copy link. Please copy manually.";
	}
}

async function revokeInvite(token: string) {
	if (!window.confirm("Revoke this invitation link? It will no longer work."))
		return;
	invitationsError = "";
	try {
		await sdk.space(spaceId).invitations.revoke(token);
		await loadInvitations();
	} catch (err) {
		invitationsError =
			err instanceof Error ? err.message : "Failed to revoke invitation";
	}
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
					<div class="flex justify-end"><button type="button" onclick={saveProfile} disabled={saving} class="px-3 py-2 rounded-[5px] bg-brand text-brand-contrast-fg text-[12px] font-medium disabled:opacity-50">Save profile</button></div>
				</section>

				<section class="rounded-[10px] border border-border-subtle bg-bg-surface p-4 space-y-3">
					<div class="flex items-center gap-2"><Globe class="w-4 h-4 text-text-tertiary" /><div><div class="text-[11px] uppercase tracking-[0.16em] text-text-placeholder">Sharing</div><div class="text-[15px] font-medium text-text-primary">Space access</div></div></div>
					<div class="flex items-center justify-between"><span class="text-[13px] text-text-secondary">Signed-in users</span><select value={access?.signed_in_user ?? ""} onchange={(e) => { const value = (e.currentTarget as HTMLSelectElement).value as SpaceRole | ""; void setAccess({ signed_in_user: value || null }); }} class="px-2 py-1 rounded bg-bg-input border border-border-subtle text-[12px]"><option value="">None</option><option value="guest">Guest</option><option value="builder">Builder</option></select></div>
					<div class="flex items-center justify-between"><span class="text-[13px] text-text-secondary">Anonymous</span><select value={access?.anonymous_user ?? ""} onchange={(e) => { const value = (e.currentTarget as HTMLSelectElement).value as SpaceRole | ""; void setAccess({ anonymous_user: value || null }); }} class="px-2 py-1 rounded bg-bg-input border border-border-subtle text-[12px]"><option value="">None</option><option value="guest">Guest</option></select></div>
				</section>

				<section class="rounded-[10px] border border-border-subtle bg-bg-surface p-4 space-y-4">
					<div class="flex items-center justify-between gap-3">
						<div class="flex items-center gap-2"><Users class="w-4 h-4 text-text-tertiary" /><div><div class="text-[11px] uppercase tracking-[0.16em] text-text-placeholder">Members</div><div class="text-[15px] font-medium text-text-primary">{members.length} member{members.length !== 1 ? 's' : ''}</div></div></div>
						<button type="button" onclick={() => { showInvitePanel = true; inviteCreateError = ""; }} class="inline-flex items-center gap-1.5 rounded-[5px] border border-brand/20 bg-brand/10 px-2.5 py-1.5 text-[12px] font-medium text-brand transition-colors hover:bg-brand/15"><Link class="w-3.5 h-3.5" /> Invite</button>
					</div>

					<div class="flex flex-col gap-2 sm:flex-row">
						<input type="text" bind:value={addingMemberUuid} placeholder="Paste user UUID" onkeydown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void addMember(); } }} class="min-w-0 flex-1 rounded-[5px] border border-border-subtle bg-bg-input px-2.5 py-1.5 font-mono text-[12px] text-text-primary placeholder:text-text-placeholder focus:border-brand/40 focus:outline-none" />
						<div class="flex gap-2">
							<select bind:value={addingMemberRole} class="rounded-[5px] border border-border-subtle bg-bg-input px-2 py-1.5 text-[12px] text-text-secondary focus:border-brand/40 focus:outline-none"><option value="guest">Guest</option><option value="builder">Builder</option><option value="host">Host</option></select>
							<button type="button" onclick={() => { void addMember(); }} disabled={savingMember || !addingMemberUuid.trim()} class="inline-flex min-w-16 items-center justify-center gap-1.5 rounded-[5px] bg-brand px-3 py-1.5 text-[12px] font-medium text-brand-contrast-fg transition-colors hover:bg-brand-hover disabled:opacity-50">{#if savingMember}<Loader2 class="w-3.5 h-3.5 animate-spin" />{:else}<Plus class="w-3.5 h-3.5" />{/if} Add</button>
						</div>
					</div>
					{#if addingMemberError}<div class="rounded-[5px] border border-error-soft/30 bg-error-bg px-3 py-2 text-[12px] text-error-soft break-all">{addingMemberError}</div>{/if}

					<div class="space-y-1">
						{#each members as member (member.userId)}
							<div class="group flex items-center gap-2 rounded-[5px] bg-bg-primary px-3 py-2">
								{#if getMemberRoleIcon(member.role)}
									<span class="w-3.5 text-center text-[12px]">{getMemberRoleIcon(member.role)}</span>
								{:else if member.role === 'builder'}
									<Pencil class="w-3.5 h-3.5 text-brand shrink-0" />
								{:else}
									<Eye class="w-3.5 h-3.5 text-text-tertiary shrink-0" />
								{/if}
								<div class="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border-subtle bg-bg-hover-strong text-[10px] font-semibold text-text-tertiary">
									{#if member.profile?.avatarUrl}
										<img src={member.profile.avatarUrl} alt="" class="h-full w-full object-cover" />
									{:else}
										{getInitials(getMemberDisplayName(member))}
									{/if}
								</div>
								<div class="min-w-0 flex-1">
									<div class="truncate text-[12px] font-medium text-text-secondary">{getMemberDisplayName(member)}</div>
									<div class="truncate text-[10px] text-text-placeholder" title={member.userId}>{member.profile?.userUuid === member.userId ? 'Profile' : 'Profile unavailable'}</div>
								</div>
								<select value={member.role} disabled={updatingMemberUserId === member.userId || removingMemberUserId === member.userId} onchange={(event) => { const role = (event.currentTarget as HTMLSelectElement).value as SpaceRole; void updateMemberRole(member.userId, role); }} class="rounded bg-transparent px-1 py-0.5 text-[10px] uppercase tracking-wider text-text-placeholder hover:bg-bg-hover focus:bg-bg-input focus:outline-none disabled:opacity-50"><option value="guest">Guest</option><option value="builder">Builder</option><option value="host">Host</option></select>
								<button type="button" onclick={() => { void removeMember(member.userId); }} disabled={removingMemberUserId === member.userId} title="Remove member" class="rounded-sm p-1 text-text-tertiary transition-colors hover:bg-bg-hover hover:text-error-soft disabled:opacity-50">{#if removingMemberUserId === member.userId}<Loader2 class="w-3 h-3 animate-spin" />{:else}<X class="w-3 h-3" />{/if}</button>
							</div>
						{:else}
							<div class="py-1 text-[12px] italic text-text-tertiary">No members</div>
						{/each}
					</div>

					<div class="h-px bg-border-subtle"></div>
					<div class="space-y-2">
						<div class="flex items-center justify-between gap-2">
							<div class="flex items-center gap-2 text-[11px] text-text-placeholder"><Link class="w-3.5 h-3.5" /> Invite links</div>
							<div class="flex items-center gap-2"><button type="button" onclick={() => { void loadInvitations(); }} disabled={loadingInvitations} class="text-[11px] text-text-placeholder hover:text-text-secondary disabled:opacity-50">Refresh</button><span class="text-[11px] text-text-tertiary">{invitations.filter((item) => item.status === 'active').length} active</span></div>
						</div>
						{#if invitationsError}<div class="rounded-[5px] border border-error-soft/30 bg-error-bg px-3 py-2 text-[12px] text-error-soft break-all">{invitationsError}</div>{/if}
						{#if loadingInvitations}
							<div class="flex items-center gap-2 py-2 text-[12px] text-text-tertiary"><Loader2 class="w-3.5 h-3.5 animate-spin" /> Loading invitations…</div>
						{:else if invitations.length === 0}
							<div class="py-1 text-[12px] italic text-text-tertiary">No invite links yet. Create one to share access without copying user IDs.</div>
						{:else}
							<div class="space-y-1.5">
								{#each invitations as invitation (invitation.token)}
									<div class="rounded-[5px] border border-border-subtle bg-bg-primary px-3 py-2">
										<div class="flex items-center justify-between gap-3">
											<div class="min-w-0 flex-1">
												<div class="flex items-center gap-2"><span class="inline-flex rounded bg-brand/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-brand">{invitation.role}</span><span class="text-[11px] text-text-tertiary">{invitation.useCount} use{invitation.useCount !== 1 ? 's' : ''}{invitation.maxUses ? ` / ${invitation.maxUses}` : ''}</span></div>
												<div class="mt-0.5 text-[10px] text-text-placeholder">{invitation.status === 'active' ? formatInviteExpiry(invitation.expiresInSeconds) : invitation.status === 'revoked' ? 'Revoked' : 'All uses exhausted'}</div>
											</div>
											{#if invitation.status === 'active'}
												<div class="flex shrink-0 items-center gap-1"><button type="button" title="Copy invite link" onclick={() => { void copyInviteLink(invitation.token); }} class="rounded-sm p-1.5 text-text-tertiary transition-colors hover:bg-bg-hover hover:text-brand">{#if copiedInviteToken === invitation.token}<Check class="w-3.5 h-3.5 text-success-soft" />{:else}<Copy class="w-3.5 h-3.5" />{/if}</button><button type="button" title="Revoke invite" onclick={() => { void revokeInvite(invitation.token); }} class="rounded-sm p-1.5 text-text-tertiary transition-colors hover:bg-bg-hover hover:text-error-soft"><Trash2 class="w-3.5 h-3.5" /></button></div>
											{/if}
										</div>
									</div>
								{/each}
							</div>
						{/if}
					</div>
				</section>

				{#if showInvitePanel}
					<div class="fixed inset-0 z-50 flex items-center justify-center bg-overlay-scrim p-4" role="presentation" onclick={() => { showInvitePanel = false; }} onkeydown={(event) => { if (event.key === 'Escape') showInvitePanel = false; }}>
						<div class="w-full max-w-sm rounded-[10px] border border-border-subtle bg-bg-surface p-5 shadow-xl" role="dialog" aria-modal="true" tabindex="-1" onclick={(event) => event.stopPropagation()} onkeydown={(event) => event.stopPropagation()}>
							<div class="mb-4 flex items-center justify-between gap-3">
								<div><h3 class="text-[15px] font-medium text-text-primary">Create invite link</h3><p class="mt-1 text-[12px] text-text-tertiary">Pre-bind a role and share a single-use or reusable access link.</p></div>
								<button type="button" onclick={() => { showInvitePanel = false; }} class="rounded p-1 text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-secondary"><X class="w-4 h-4" /></button>
							</div>
							{#if inviteCreateError}<div class="mb-3 rounded-[5px] border border-error-soft/30 bg-error-bg px-3 py-2 text-[12px] text-error-soft break-all">{inviteCreateError}</div>{/if}
							<div class="space-y-3">
								<div><label class="mb-1.5 block text-[10px] font-medium uppercase tracking-wider text-text-tertiary" for="invite-role">Role</label><select id="invite-role" bind:value={inviteRole} class="w-full rounded-[5px] border border-border-subtle bg-bg-input px-3 py-1.5 text-[13px] text-text-primary focus:border-brand/40 focus:outline-none"><option value="builder">Builder</option><option value="guest">Guest</option><option value="host">Host</option></select></div>
								<div><label class="mb-1.5 block text-[10px] font-medium uppercase tracking-wider text-text-tertiary" for="invite-ttl">Valid for</label><select id="invite-ttl" bind:value={inviteTtlDays} class="w-full rounded-[5px] border border-border-subtle bg-bg-input px-3 py-1.5 text-[13px] text-text-primary focus:border-brand/40 focus:outline-none"><option value={1}>1 day</option><option value={7}>7 days</option><option value={14}>14 days</option><option value={30}>30 days</option></select></div>
								<div><label class="mb-1.5 block text-[10px] font-medium uppercase tracking-wider text-text-tertiary" for="invite-max-uses">Max uses <span class="normal-case tracking-normal text-text-placeholder">(0 = unlimited)</span></label><input id="invite-max-uses" type="number" bind:value={inviteMaxUses} min="0" max="10000" step="1" class="w-full rounded-[5px] border border-border-subtle bg-bg-input px-3 py-1.5 text-[13px] text-text-primary focus:border-brand/40 focus:outline-none" /></div>
							</div>
							<div class="mt-5 flex justify-end gap-2">
								<button type="button" onclick={() => { showInvitePanel = false; }} class="rounded-[5px] border border-border-subtle bg-bg-hover px-4 py-1.5 text-[12px] text-text-tertiary transition-colors hover:bg-bg-hover-strong hover:text-text-secondary">Cancel</button>
								<button type="button" onclick={() => { void createInvite(); }} disabled={creatingInvite} class="inline-flex items-center gap-1.5 rounded-[5px] bg-brand px-4 py-1.5 text-[12px] font-medium text-brand-contrast-fg transition-colors hover:bg-brand-hover disabled:opacity-50">{#if creatingInvite}<Loader2 class="w-3.5 h-3.5 animate-spin" /> Creating…{:else}<Link class="w-3.5 h-3.5" /> Create link{/if}</button>
							</div>
						</div>
					</div>
				{/if}

				<section class="rounded-[10px] border border-border-subtle bg-bg-surface p-4 space-y-3">
					<div class="flex items-center gap-2"><Terminal class="w-4 h-4 text-text-tertiary" /><div><div class="text-[11px] uppercase tracking-[0.16em] text-text-placeholder">Env</div><div class="text-[15px] font-medium text-text-primary">Environment variables</div></div></div>
					<div class="flex gap-2"><input bind:value={envName} placeholder="NAME" class="w-40 px-2 py-1.5 rounded bg-bg-input border border-border-subtle text-[12px] font-mono" /><input bind:value={envValue} placeholder="value" class="flex-1 px-2 py-1.5 rounded bg-bg-input border border-border-subtle text-[12px] font-mono" /><button type="button" onclick={addEnv} class="px-3 py-1.5 rounded bg-brand text-brand-contrast-fg text-[12px]">Add</button></div>
					<div class="space-y-1">{#each env as item (item.name)}<div class="flex items-center gap-2 rounded-[5px] bg-bg-primary px-3 py-2"><code class="w-40 text-[11px] text-text-primary">{item.name}</code><code class="flex-1 truncate text-[11px] text-text-tertiary">{revealedEnvNames.has(item.name) ? item.value : '••••••••'}</code><button type="button" onclick={() => toggleEnvReveal(item.name)} class="text-[11px] text-text-placeholder hover:text-text-secondary">{revealedEnvNames.has(item.name) ? 'Hide' : 'Reveal'}</button><button type="button" onclick={() => removeEnv(item.name)} class="text-[11px] text-text-placeholder hover:text-error-soft">Remove</button></div>{/each}</div>
				</section>

				<section class="rounded-[10px] border border-border-subtle bg-bg-surface p-4 space-y-3">
					<div class="flex items-center gap-2"><Network class="w-4 h-4 text-text-tertiary" /><div><div class="text-[11px] uppercase tracking-[0.16em] text-text-placeholder">Channels</div><div class="text-[15px] font-medium text-text-primary">Bound channels</div></div></div>
					<div class="flex gap-2"><select bind:value={selectedChannelId} class="flex-1 px-2 py-1.5 rounded bg-bg-input border border-border-subtle text-[12px]"><option value="">Select channel</option>{#each allChannels.filter((ch) => !channels.some((binding) => binding.channelId === ch.id)) as channel (channel.id)}<option value={channel.id}>{channel.provider} · {channel.name}</option>{/each}</select><button type="button" onclick={bindChannel} class="px-3 py-1.5 rounded bg-brand text-brand-contrast-fg text-[12px]">Bind</button></div>
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
