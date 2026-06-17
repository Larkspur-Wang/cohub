<script lang="ts">
import {
	type DefaultSpaceModDefinition,
	getDefaultSpaceModsForEnv,
	normalizeCohubRuntimeEnv,
} from "@cohub/protocol";
import type {
	Channel,
	SpaceAccessPolicy,
	SpaceChannelBindingRecord,
	SpaceEnvInput,
	SpaceInvitation,
	SpaceMember,
	SpaceModListItem,
	SpaceRecord,
	SpaceRole,
	SpaceSandboxAutoDestroyPolicy,
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
	PackagePlus,
	Pencil,
	Plus,
	RefreshCw,
	Settings,
	Terminal,
	Trash2,
	Upload,
	Users,
	X,
} from "lucide-svelte";
import { onDestroy } from "svelte";
import { goto } from "$app/navigation";
import { PUBLIC_COHUB_ENV } from "$env/static/public";
import { normalizeAvatarToWebp } from "$lib/avatar-image";
import CenteredLoading from "$lib/components/CenteredLoading.svelte";
import SpaceAvatar from "$lib/components/SpaceAvatar.svelte";
import { isComposingKeyboardEvent } from "$lib/keyboard";
import { sdk } from "$lib/sdk";
import { validatePublicSlugInput } from "$lib/slug-rules";
import { buildSpaceLandingRoute } from "$lib/space-routes";
import { invalidateCachedSpaceMembers } from "$lib/stores/space-profile-cache";
import { cacheSpaceRecordSoon } from "$lib/stores/space-record-cache";

type SandboxInfo = {
	status: string | null;
	runtimeStatus?: string | null;
	podName?: string | null;
	desiredImage?: string | null;
	reportedImageVersion?: string | null;
	lastHeartbeatAt?: string | null;
	lastActivityAt?: string | null;
	reportedAt?: string | null;
	stoppedAt?: string | null;
	stopReason?: string | null;
	meta?: Record<string, unknown> | null;
};

const props = $props<{ data: { spaceId: string } }>();
const spaceId = $derived(props.data.spaceId);
const defaultIdleTtlSeconds = import.meta.env.DEV ? 10 * 60 : 12 * 60 * 60;
const recommendedBaseMod =
	getDefaultSpaceModsForEnv(normalizeCohubRuntimeEnv(PUBLIC_COHUB_ENV))[0] ??
	null;

let space = $state<SpaceRecord | null>(null);
let access = $state<SpaceAccessPolicy | null>(null);
let members = $state<SpaceMember[]>([]);
let invitations = $state<SpaceInvitation[]>([]);
let env = $state<SpaceEnvInput[]>([]);
let channels = $state<SpaceChannelBindingRecord[]>([]);
let mods = $state<SpaceModListItem[]>([]);
let sandbox = $state<SandboxInfo | null>(null);
let allChannels = $state<Channel[]>([]);
let loading = $state(true);
let error = $state("");
let envName = $state("");
let envValue = $state("");
let selectedChannelId = $state("");
let modSpaceId = $state("");
let modName = $state("");
let modMountSlug = $state("");
let modError = $state("");
let modSaving = $state(false);
let modUpdatingId = $state<string | null>(null);
let modRestartMessage = $state("");
let modRestartTimer: ReturnType<typeof setTimeout> | null = null;
let revealedEnvNames = $state<Set<string>>(new Set());
let copiedMemberUserId = $state<string | null>(null);
let copiedMemberTimer: ReturnType<typeof setTimeout> | null = null;
let addingMemberUuid = $state("");
let addingMemberRole = $state<SpaceRole>("guest");
let savingMember = $state(false);
let accessError = $state("");
let envError = $state("");
let channelError = $state("");
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
let inviteCreateNotice = $state("");
let inviteNoticeTimer: ReturnType<typeof setTimeout> | null = null;
let copiedInviteToken = $state<string | null>(null);
let copiedInviteTimer: ReturnType<typeof setTimeout> | null = null;
let recoveringSandbox = $state(false);
let sandboxRecoveryMessage = $state("");
let sandboxRecoveryError = $state("");
let sandboxAutoDestroyMode = $state<"idle" | "never">("idle");
let sandboxIdleTtlSeconds = $state(defaultIdleTtlSeconds);
let savingSandboxConfig = $state(false);
let sandboxConfigMessage = $state("");
let sandboxConfigError = $state("");
let renamingSpace = $state(false);
let renameInput = $state("");
let renameSaving = $state(false);
let renameError = $state("");
let spaceDescriptionDraft = $state("");
let spaceDescriptionSaving = $state(false);
let spaceProfileError = $state("");
let spaceAvatarUploading = $state(false);
let editingSpaceSlug = $state(false);
let spaceSlugDraft = $state("");
let spaceSlugSaving = $state(false);
let spaceSlugError = $state("");
let copiedSpaceId = $state(false);
let copiedSpaceIdTimer: ReturnType<typeof setTimeout> | null = null;
let copiedSpaceSlugLink = $state(false);
let copiedSpaceSlugLinkTimer: ReturnType<typeof setTimeout> | null = null;
const shouldShowBaseModRecommendation = $derived(
	recommendedBaseMod
		? !mods.some((mod) => mod.modSpaceId === recommendedBaseMod.modSpaceId)
		: false,
);
const canEditSpaceProfile = $derived(
	space?.access?.permissions.includes("space.edit") === true,
);
const canManageSpaceMembers = $derived(
	space?.access?.permissions.includes("member.manage") === true,
);
const canManageSpaceChannels = $derived(
	space?.access?.permissions.includes("channel.manage") === true,
);
const canManageSpaceMods = $derived(
	space?.access?.permissions.includes("mod.manage") === true,
);
const canManageSpaceSandbox = $derived(
	space?.access?.permissions.includes("sandbox.manage") === true,
);

onDestroy(() => {
	if (inviteNoticeTimer) clearTimeout(inviteNoticeTimer);
	if (copiedInviteTimer) clearTimeout(copiedInviteTimer);
	if (modRestartTimer) clearTimeout(modRestartTimer);
	if (copiedMemberTimer) clearTimeout(copiedMemberTimer);
	if (copiedSpaceIdTimer) clearTimeout(copiedSpaceIdTimer);
	if (copiedSpaceSlugLinkTimer) clearTimeout(copiedSpaceSlugLinkTimer);
});

function getSpaceAutoDestroyPolicy(
	record: SpaceRecord | null,
): SpaceSandboxAutoDestroyPolicy {
	const fallback = { mode: "idle" as const, ttlSeconds: defaultIdleTtlSeconds };
	const policy = record?.meta?.config?.sandbox?.autoDestroy;
	if (!policy) return fallback;
	if (policy.mode === "never") return { mode: "never" };
	if (policy.mode === "idle" && Number.isInteger(policy.ttlSeconds))
		return policy;
	return fallback;
}

function applySandboxConfigFromSpace(record: SpaceRecord | null) {
	const policy = getSpaceAutoDestroyPolicy(record);
	sandboxAutoDestroyMode = policy.mode;
	sandboxIdleTtlSeconds =
		policy.mode === "idle" ? policy.ttlSeconds : defaultIdleTtlSeconds;
}

function formatTtl(seconds: number): string {
	if (seconds % 86400 === 0) return `${seconds / 86400}d`;
	if (seconds % 3600 === 0) return `${seconds / 3600}h`;
	if (seconds % 60 === 0) return `${seconds / 60}m`;
	return `${seconds}s`;
}

async function saveSandboxConfig() {
	if (!canManageSpaceSandbox) return;
	savingSandboxConfig = true;
	sandboxConfigMessage = "";
	sandboxConfigError = "";
	try {
		const autoDestroy: SpaceSandboxAutoDestroyPolicy =
			sandboxAutoDestroyMode === "never"
				? { mode: "never" }
				: { mode: "idle", ttlSeconds: Number(sandboxIdleTtlSeconds) };
		const result = await sdk
			.space(spaceId)
			.updateConfig({ sandbox: { autoDestroy } });
		space = result.space;
		cacheSpaceRecordSoon(result.space);
		applySandboxConfigFromSpace(result.space);
		sandboxConfigMessage = "Sandbox hibernate policy saved.";
	} catch (err) {
		sandboxConfigError =
			err instanceof Error ? err.message : "Failed to save sandbox config";
	} finally {
		savingSandboxConfig = false;
	}
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

function formatRelativeTime(value?: string | null): string {
	if (!value) return "—";
	const date = new Date(value);
	const time = date.getTime();
	if (Number.isNaN(time)) return "—";
	const diffMs = Date.now() - time;
	const absMs = Math.abs(diffMs);
	const minute = 60_000;
	const hour = 60 * minute;
	const day = 24 * hour;
	const suffix = diffMs >= 0 ? "ago" : "from now";
	if (absMs < minute) return "just now";
	if (absMs < hour) return `${Math.round(absMs / minute)}m ${suffix}`;
	if (absMs < day) return `${Math.round(absMs / hour)}h ${suffix}`;
	return `${Math.round(absMs / day)}d ${suffix}`;
}

function getSandboxLifecycleLabel(status?: string | null): string {
	switch (status) {
		case "running":
		case "ready":
			return "Running";
		case "provisioning":
		case "pending":
			return "Provisioning";
		case "stopping":
			return "Stopping";
		case "stopped":
			return "Stopped";
		case "error":
			return "Error";
		case "terminated":
			return "Terminated";
		default:
			return "Unknown";
	}
}

function getSandboxRuntimeLabel(status?: string | null): string {
	switch (status) {
		case "healthy":
			return "Healthy";
		case "starting":
			return "Starting";
		case "degraded":
			return "Degraded";
		case "unhealthy":
			return "Unhealthy";
		default:
			return "Unknown";
	}
}

function getSandboxStatusClass(status?: string | null): string {
	if (status === "running" || status === "ready" || status === "healthy")
		return "bg-success-bg text-success-soft ring-success-soft/20";
	if (
		status === "provisioning" ||
		status === "pending" ||
		status === "starting" ||
		status === "stopping"
	)
		return "bg-brand-bg text-brand-muted-fg ring-brand/20";
	if (status === "stopped" || status === "unknown")
		return "bg-bg-hover text-text-tertiary ring-border-subtle";
	return "bg-error-bg text-error-soft ring-error-soft/25";
}

function getSandboxActivityText(): string {
	const activity = formatRelativeTime(sandbox?.lastActivityAt);
	if (activity !== "—") return activity;
	return formatRelativeTime(sandbox?.lastHeartbeatAt);
}

function getSandboxActivityLabel(): string {
	return sandbox?.lastActivityAt ? "Last RPC activity" : "No RPC activity yet";
}

function getSandboxActivityTitle(): string {
	const label = getSandboxActivityLabel();
	const activityTime = formatTime(sandbox?.lastActivityAt);
	const heartbeatTime = formatTime(sandbox?.lastHeartbeatAt);
	return `${label}\nLast RPC activity: ${activityTime}\nHeartbeat: ${heartbeatTime}\nIdle hibernation is driven by sandbox RPC / tool calls.`;
}

function getSandboxHeartbeatTitle(): string {
	return `Sandbox self-report\nLast heartbeat: ${formatTime(sandbox?.lastHeartbeatAt)}\nHeartbeat only means the sandbox runtime recently reported itself alive.`;
}

function getSpaceOwnerUsername(record: SpaceRecord | null): string {
	return record?.ownerProfile?.username?.trim() ?? "";
}

function getSpaceSlug(record: SpaceRecord | null): string {
	return record?.slug?.trim() ?? "";
}

function getSpacePublicPath(record: SpaceRecord | null): string {
	const username = getSpaceOwnerUsername(record);
	const slug = getSpaceSlug(record);
	return username && slug ? `/${username}/${slug}` : "";
}

function getSpacePrettyUrlHint(record: SpaceRecord | null): string {
	const hasUsername = Boolean(getSpaceOwnerUsername(record));
	const hasSlug = Boolean(getSpaceSlug(record));
	if (hasUsername && hasSlug) return "";
	if (!hasUsername && !hasSlug)
		return "Add a space slug and username for a cleaner URL.";
	if (!hasUsername)
		return "Add username in Profile to complete the pretty URL.";
	return "Add a space slug for a cleaner URL.";
}

function formatCompactId(id: string): string {
	if (!id) return "";
	if (id.length <= 13) return id;
	return `${id.slice(0, 8)}…${id.slice(-4)}`;
}

async function handleRenameSpace(newName: string) {
	renameSaving = true;
	renameError = "";
	try {
		const result = await sdk.space(spaceId).rename(newName);
		space = result.space;
		cacheSpaceRecordSoon(result.space);
		renamingSpace = false;
	} catch (err) {
		renameError = err instanceof Error ? err.message : "Failed to rename space";
	} finally {
		renameSaving = false;
	}
}

function beginSpaceSlugEdit() {
	if (!canEditSpaceProfile || spaceSlugSaving) return;
	spaceSlugDraft = space?.slug ?? "";
	spaceSlugError = "";
	editingSpaceSlug = true;
}

function cancelSpaceSlugEdit() {
	if (spaceSlugSaving) return;
	editingSpaceSlug = false;
	spaceSlugDraft = "";
	spaceSlugError = "";
}

function handleSpaceSlugKeydown(event: KeyboardEvent) {
	if (event.key === "Escape") {
		event.preventDefault();
		cancelSpaceSlugEdit();
		return;
	}
	if (event.key === "Enter" && !isComposingKeyboardEvent(event)) {
		event.preventDefault();
		void saveSpaceSlug();
	}
}

async function saveSpaceSlug() {
	if (!space || spaceSlugSaving) return;
	spaceSlugError = "";
	const result = validatePublicSlugInput(spaceSlugDraft);
	if (result.error) {
		spaceSlugError = result.error;
		return;
	}
	const nextSlug = result.value;
	if (nextSlug === space.slug) {
		editingSpaceSlug = false;
		return;
	}
	spaceSlugSaving = true;
	try {
		const updateResult = await sdk.space(spaceId).update({ slug: nextSlug });
		space = updateResult.space;
		cacheSpaceRecordSoon(updateResult.space);
		editingSpaceSlug = false;
		spaceSlugDraft = "";
	} catch (err) {
		spaceSlugError =
			err instanceof Error ? err.message : "Failed to save space slug";
	} finally {
		spaceSlugSaving = false;
	}
}

async function copySpaceId() {
	try {
		await navigator.clipboard.writeText(spaceId);
		copiedSpaceId = true;
		if (copiedSpaceIdTimer) clearTimeout(copiedSpaceIdTimer);
		copiedSpaceIdTimer = setTimeout(() => {
			copiedSpaceId = false;
		}, 2000);
	} catch {
		// Clipboard failures are non-critical.
	}
}

async function copySpacePublicLink() {
	const path = getSpacePublicPath(space);
	if (!path) return;
	try {
		await navigator.clipboard.writeText(`${window.location.origin}${path}`);
		copiedSpaceSlugLink = true;
		if (copiedSpaceSlugLinkTimer) clearTimeout(copiedSpaceSlugLinkTimer);
		copiedSpaceSlugLinkTimer = setTimeout(() => {
			copiedSpaceSlugLink = false;
		}, 2000);
	} catch {
		// Clipboard failures are non-critical.
	}
}

async function saveSpaceDescription() {
	if (spaceDescriptionSaving) return;
	spaceDescriptionSaving = true;
	spaceProfileError = "";
	try {
		const result = await sdk.space(spaceId).profile({
			description: spaceDescriptionDraft.trim() || null,
		});
		space = result.space;
		cacheSpaceRecordSoon(result.space);
	} catch (err) {
		spaceProfileError =
			err instanceof Error ? err.message : "Failed to save space profile";
	} finally {
		spaceDescriptionSaving = false;
	}
}

function handleDescriptionKeydown(event: KeyboardEvent) {
	if (
		(event.metaKey || event.ctrlKey) &&
		event.key === "Enter" &&
		!isComposingKeyboardEvent(event)
	) {
		event.preventDefault();
		void saveSpaceDescription();
	}
}

async function uploadSpaceAvatar(file: File) {
	if (!canEditSpaceProfile || spaceAvatarUploading) return;
	spaceAvatarUploading = true;
	spaceProfileError = "";
	try {
		const avatarFile = await normalizeAvatarToWebp(file);
		const plan = await sdk.publicAssets.createUpload({
			purpose: "space_avatar",
			spaceId,
			file: {
				size: avatarFile.size,
				mimeType: "image/webp",
			},
		});
		const formData = new FormData();
		for (const [key, value] of Object.entries(plan.asset.uploadFields)) {
			formData.append(key, value);
		}
		formData.append("file", avatarFile);
		const response = await fetch(plan.asset.uploadUrl, {
			method: plan.asset.uploadMethod,
			body: formData,
		});
		if (!response.ok) throw new Error("Failed to upload avatar image.");
		const result = await sdk.space(spaceId).profile({
			description: space?.description ?? null,
			avatarUrl: plan.asset.publicUrl,
		});
		space = result.space;
		cacheSpaceRecordSoon(result.space);
	} catch (err) {
		spaceProfileError =
			err instanceof Error ? err.message : "Failed to upload space avatar";
	} finally {
		spaceAvatarUploading = false;
	}
}

function handleSpaceAvatarFileChange(event: Event) {
	const input = event.currentTarget as HTMLInputElement;
	const file = input.files?.[0];
	input.value = "";
	if (file) void uploadSpaceAvatar(file);
}

async function loadSandbox() {
	const result = await sdk
		.space(spaceId)
		.sandbox.get()
		.catch(() => null);
	sandbox = result?.sandbox ?? null;
}

function confirmModRestart(): boolean {
	return window.confirm(
		"Changing Space Mods will restart the Sandbox and may interrupt running commands or agent turns. Continue?",
	);
}

function noteModRestart() {
	modRestartMessage =
		"Sandbox restart queued. Mods will be mounted when it comes back online.";
	if (modRestartTimer) clearTimeout(modRestartTimer);
	modRestartTimer = setTimeout(() => {
		modRestartMessage = "";
	}, 6000);
}

async function loadMods() {
	const result = await sdk.space(spaceId).mods.list();
	mods = result.items;
}

async function forceRecoverSandbox() {
	if (recoveringSandbox || !canManageSpaceSandbox) return;
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
			modResult,
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
			sdk
				.space(spaceId)
				.mods.list()
				.catch(() => ({ items: [] })),
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
		spaceDescriptionDraft = spaceResult.description ?? "";
		cacheSpaceRecordSoon(spaceResult);
		access = accessResult;
		members = memberResult.items;
		env = envResult.env;
		channels = channelResult;
		mods = modResult.items;
		allChannels = allChannelResult;
		sandbox = sandboxResult?.sandbox ?? null;
		invitations = invitationResult.items;
		applySandboxConfigFromSpace(spaceResult);
	} catch (err) {
		error = err instanceof Error ? err.message : "Failed to load settings";
	} finally {
		loading = false;
	}
}

async function setAccess(body: {
	signed_in_user?: SpaceRole | null;
	anonymous_user?: SpaceRole | null;
}) {
	if (!canManageSpaceMembers) return;
	accessError = "";
	try {
		access = await sdk.space(spaceId).access.set(body);
	} catch (err) {
		accessError = err instanceof Error ? err.message : "Failed to save access";
	}
}

async function addEnv() {
	if (!canEditSpaceProfile || !envName.trim()) return;
	envError = "";
	try {
		const result = await sdk
			.space(spaceId)
			.env.create({ name: envName.trim(), value: envValue });
		env = result.env;
		envName = "";
		envValue = "";
	} catch (err) {
		envError = err instanceof Error ? err.message : "Failed to add variable";
	}
}

async function removeEnv(name: string) {
	if (!canEditSpaceProfile) return;
	envError = "";
	try {
		const result = await sdk.space(spaceId).env.remove(name);
		env = result.env;
	} catch (err) {
		envError = err instanceof Error ? err.message : "Failed to remove variable";
	}
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
	if (!canManageSpaceMembers || !addingMemberUuid.trim() || savingMember)
		return;
	savingMember = true;
	addingMemberError = "";
	try {
		await sdk
			.space(spaceId)
			.members.update(addingMemberUuid.trim(), addingMemberRole);
		invalidateCachedSpaceMembers(spaceId);
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

function getMemberUuid(member: SpaceMember): string {
	return member.profile?.userUuid ?? member.userId;
}

async function copyMemberUuid(member: SpaceMember) {
	const value = getMemberUuid(member);
	try {
		if (navigator.clipboard?.writeText) {
			await navigator.clipboard.writeText(value);
		} else {
			const textarea = document.createElement("textarea");
			textarea.value = value;
			textarea.setAttribute("readonly", "true");
			textarea.style.position = "fixed";
			textarea.style.opacity = "0";
			document.body.appendChild(textarea);
			textarea.select();
			const copied = document.execCommand("copy");
			document.body.removeChild(textarea);
			if (!copied) return;
		}
		copiedMemberUserId = member.userId;
		if (copiedMemberTimer) clearTimeout(copiedMemberTimer);
		copiedMemberTimer = setTimeout(() => {
			copiedMemberUserId = null;
		}, 2000);
	} catch {
		// ignore copy failure silently
	}
}

async function updateMemberRole(userId: string, role: SpaceRole) {
	if (!canManageSpaceMembers) return;
	updatingMemberUserId = userId;
	addingMemberError = "";
	try {
		await sdk.space(spaceId).members.update(userId, role);
		invalidateCachedSpaceMembers(spaceId);
		await loadMembers();
	} catch (err) {
		addingMemberError =
			err instanceof Error ? err.message : "Failed to update member";
	} finally {
		updatingMemberUserId = null;
	}
}

async function removeMember(userId: string) {
	if (!canManageSpaceMembers) return;
	if (!window.confirm("Remove this member from the space?")) return;
	removingMemberUserId = userId;
	addingMemberError = "";
	try {
		await sdk.space(spaceId).members.remove(userId);
		invalidateCachedSpaceMembers(spaceId);
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
	if (creatingInvite || !canManageSpaceMembers) return;
	if (inviteMaxUses < 0 || inviteMaxUses > 10000) {
		inviteCreateError = "Max uses must be between 0 and 10000";
		return;
	}
	creatingInvite = true;
	inviteCreateError = "";
	inviteCreateNotice = "";
	try {
		const created = await sdk.space(spaceId).invitations.create({
			role: inviteRole,
			ttlSeconds: inviteTtlDays * 24 * 60 * 60,
			maxUses: inviteMaxUses || undefined,
		});
		const copied = await copyInviteLink(created.token);
		inviteCreateNotice = copied
			? "Invite link created and copied to clipboard."
			: "Invite link created. Copying failed, please copy it manually.";
		if (inviteNoticeTimer) clearTimeout(inviteNoticeTimer);
		inviteNoticeTimer = setTimeout(() => {
			inviteCreateNotice = "";
		}, 4000);
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
	const url = `${window.location.origin}/invite/${token}`;
	try {
		if (navigator.clipboard?.writeText) {
			await navigator.clipboard.writeText(url);
		} else {
			const textarea = document.createElement("textarea");
			textarea.value = url;
			textarea.setAttribute("readonly", "true");
			textarea.style.position = "fixed";
			textarea.style.opacity = "0";
			document.body.appendChild(textarea);
			textarea.select();
			const copied = document.execCommand("copy");
			document.body.removeChild(textarea);
			if (!copied) return false;
		}
		copiedInviteToken = token;
		if (copiedInviteTimer) clearTimeout(copiedInviteTimer);
		copiedInviteTimer = setTimeout(() => {
			copiedInviteToken = null;
		}, 2000);
		return true;
	} catch {
		return false;
	}
}

async function revokeInvite(token: string) {
	if (!canManageSpaceMembers) return;
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
	if (!canManageSpaceChannels || !selectedChannelId) return;
	channelError = "";
	try {
		await sdk.space(spaceId).channels.bind(selectedChannelId);
		channels = await sdk.space(spaceId).channels.list();
		selectedChannelId = "";
	} catch (err) {
		channelError =
			err instanceof Error ? err.message : "Failed to bind channel";
	}
}

async function unbindChannel(channelId: string) {
	if (!canManageSpaceChannels) return;
	channelError = "";
	try {
		await sdk.space(spaceId).channels.unbind(channelId);
		channels = await sdk.space(spaceId).channels.list();
	} catch (err) {
		channelError =
			err instanceof Error ? err.message : "Failed to unbind channel";
	}
}

async function addMod() {
	if (!canManageSpaceMods) return;
	const target = modSpaceId.trim();
	if (!target || modSaving) return;
	if (mods.some((mod) => mod.modSpaceId === target)) {
		modError = "Mod space is already mounted";
		return;
	}
	if (!confirmModRestart()) return;
	modSaving = true;
	modError = "";
	try {
		const result = await sdk.space(spaceId).mods.create({
			modSpaceId: target,
			name: modName.trim() || null,
			mountSlug: modMountSlug.trim() || null,
		});
		mods = result.item
			? [...mods, result.item].sort((a, b) => a.sortOrder - b.sortOrder)
			: (await sdk.space(spaceId).mods.list()).items;
		modSpaceId = "";
		modName = "";
		modMountSlug = "";
		noteModRestart();
		await loadSandbox();
	} catch (err) {
		modError = err instanceof Error ? err.message : "Failed to add mod";
	} finally {
		modSaving = false;
	}
}

function fillRecommendedMod(mod: DefaultSpaceModDefinition) {
	if (!canManageSpaceMods) return;
	modSpaceId = mod.modSpaceId;
	modName = mod.name ?? "";
	modMountSlug = mod.mountSlug ?? "";
	modError = "";
}

async function toggleMod(mod: SpaceModListItem) {
	if (!canManageSpaceMods) return;
	if (!confirmModRestart()) return;
	modUpdatingId = mod.id;
	modError = "";
	try {
		const result = await sdk
			.space(spaceId)
			.mods.update(mod.id, { enabled: !mod.enabled });
		mods = mods.map((item) => (item.id === mod.id ? result.item : item));
		noteModRestart();
		await loadSandbox();
	} catch (err) {
		modError = err instanceof Error ? err.message : "Failed to update mod";
	} finally {
		modUpdatingId = null;
	}
}

async function updateModMountSlug(mod: SpaceModListItem, mountSlug: string) {
	if (!canManageSpaceMods) return;
	if (!confirmModRestart()) return;
	modUpdatingId = mod.id;
	modError = "";
	try {
		const result = await sdk
			.space(spaceId)
			.mods.update(mod.id, { mountSlug: mountSlug || undefined });
		mods = mods.map((item) => (item.id === mod.id ? result.item : item));
		noteModRestart();
		await loadSandbox();
	} catch (err) {
		modError = err instanceof Error ? err.message : "Failed to update mod";
	} finally {
		modUpdatingId = null;
	}
}

async function removeMod(mod: SpaceModListItem) {
	if (!canManageSpaceMods) return;
	if (!confirmModRestart()) return;
	modUpdatingId = mod.id;
	modError = "";
	try {
		await sdk.space(spaceId).mods.remove(mod.id);
		mods = mods.filter((item) => item.id !== mod.id);
		noteModRestart();
		await loadSandbox();
	} catch (err) {
		modError = err instanceof Error ? err.message : "Failed to remove mod";
	} finally {
		modUpdatingId = null;
	}
}

$effect(() => {
	void loadPage();
});
</script>

<svelte:head><title>Space settings — Cohub</title></svelte:head>

<div class="flex min-h-0 flex-1 flex-col overflow-hidden bg-bg-primary">
	<header class="flex h-[44px] shrink-0 items-center justify-between border-b border-border-subtle bg-bg-primary px-3 sm:px-4">
		<div class="flex min-w-0 items-center gap-3">
			<button
				type="button"
				class="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-primary focus:outline-none focus:ring-1 focus:ring-brand/40"
				aria-label="Back to space"
				onclick={() => goto(buildSpaceLandingRoute(spaceId))}
			>
				<ArrowLeft class="h-4 w-4" />
			</button>
			<div class="min-w-0">
				<div class="truncate text-[13px] font-medium text-text-primary">Space settings</div>
			</div>
		</div>
	</header>

	<main class="min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-5 sm:py-6">
		<div class="mx-auto w-full max-w-4xl space-y-4 sm:space-y-5">
			{#if loading}
				<CenteredLoading label="Loading settings…" size="compact" variant="surface" />
			{:else if error}
				<div class="rounded-[8px] border border-error-soft/30 bg-error-bg p-3 text-[12px] text-error-soft">{error}</div>
			{:else}
				<section class="overflow-hidden rounded-[10px] border border-border-subtle bg-bg-surface">
					<div class="flex flex-col gap-3 border-b border-border-subtle px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
						<div class="flex min-w-0 items-center gap-2.5">
							<Globe class="h-4 w-4 text-text-tertiary" />
							<div class="min-w-0">
								<div class="text-[15px] font-medium text-text-primary">Profile</div>
								<div class="text-[12px] text-text-tertiary">Name, avatar, description, public URL.</div>
							</div>
						</div>
					</div>
					<div class="space-y-5 p-4 sm:p-5">
						<div class="flex flex-col gap-4 sm:flex-row sm:items-start">
							<div class="flex w-16 shrink-0 flex-col items-center gap-1.5">
								{#if canEditSpaceProfile}
									<label class="group relative h-14 w-14 cursor-pointer overflow-hidden rounded-full border border-border-subtle bg-bg-hover-strong transition-colors hover:border-brand/50 focus-within:border-brand/50" title="Change space avatar" aria-label="Change space avatar">
										<SpaceAvatar name={space?.name || space?.title || spaceId} profile={space?.publicProfile} size="lg" class="h-full w-full rounded-full border-0 shadow-none" />
										<span class="absolute inset-0 flex items-center justify-center bg-overlay-scrim-strong opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100">
											{#if spaceAvatarUploading}<Loader2 class="h-4 w-4 animate-spin text-overlay-control-text" />{:else}<Upload class="h-4 w-4 text-overlay-control-text" />{/if}
										</span>
										<input type="file" accept="image/jpeg,image/png,image/webp" class="sr-only" disabled={spaceAvatarUploading} onchange={handleSpaceAvatarFileChange} />
									</label>
									<label class="inline-flex cursor-pointer items-center gap-1 rounded-[4px] px-1 py-0.5 text-[11px] leading-none text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-secondary focus-within:bg-bg-hover focus-within:text-text-secondary {spaceAvatarUploading ? 'pointer-events-none opacity-50' : ''}">
										{#if spaceAvatarUploading}<Loader2 class="h-3 w-3 animate-spin" />{:else}<Upload class="h-3 w-3" />{/if}
										<span>{space?.publicProfile?.avatarUrl ? "Change" : "Upload"}</span>
										<input type="file" accept="image/jpeg,image/png,image/webp" class="sr-only" disabled={spaceAvatarUploading} onchange={handleSpaceAvatarFileChange} />
									</label>
								{:else}
									<SpaceAvatar name={space?.name || space?.title || spaceId} profile={space?.publicProfile} size="lg" class="h-14 w-14 rounded-full" />
								{/if}
							</div>
							<div class="min-w-0 flex-1 space-y-4">
								<div class="min-w-0">
									<div class="flex min-w-0 items-center gap-1.5">
										{#if renamingSpace && canEditSpaceProfile}
											<input type="text" bind:value={renameInput} disabled={renameSaving} class="min-w-0 flex-1 rounded-[6px] border border-brand/40 bg-bg-input px-2 py-1 text-[20px] font-medium text-text-primary transition-colors focus:outline-none disabled:opacity-60" onkeydown={(event) => { if (event.key === 'Enter' && !renameSaving && !isComposingKeyboardEvent(event)) { event.preventDefault(); const trimmed = renameInput.trim(); if (trimmed && trimmed !== space?.name) void handleRenameSpace(trimmed); else { renamingSpace = false; renameError = ''; } } if (event.key === 'Escape' && !renameSaving) { renamingSpace = false; renameError = ''; } }} />
											<button type="button" class="shrink-0 rounded-[5px] p-1.5 text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-secondary disabled:opacity-50" title="Save" disabled={renameSaving} onclick={() => { const trimmed = renameInput.trim(); if (trimmed && trimmed !== space?.name) void handleRenameSpace(trimmed); else { renamingSpace = false; renameError = ''; } }}>{#if renameSaving}<Loader2 class="h-3.5 w-3.5 animate-spin" />{:else}<Check class="h-3.5 w-3.5" />{/if}</button>
											<button type="button" class="shrink-0 rounded-[5px] p-1.5 text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-secondary disabled:opacity-50" title="Cancel" disabled={renameSaving} onclick={() => { renamingSpace = false; renameError = ''; }}><X class="h-3.5 w-3.5" /></button>
										{:else if canEditSpaceProfile}
											<button type="button" onclick={() => { renameInput = space?.name ?? ''; renamingSpace = true; renameError = ''; }} class="group/edit -ml-1 flex max-w-full items-center gap-1.5 rounded-[5px] px-1 py-0.5 text-left transition-colors hover:bg-bg-hover" title="Rename space"><span class="min-w-0 truncate text-[20px] font-medium text-text-primary group-hover/edit:text-brand">{space?.name || space?.title || spaceId}</span><Pencil class="h-3.5 w-3.5 shrink-0 text-text-placeholder opacity-0 transition-opacity group-hover/edit:opacity-100" /></button>
										{:else}
											<h2 class="min-w-0 truncate text-[20px] font-medium text-text-primary">{space?.name || space?.title || spaceId}</h2>
										{/if}
									</div>
									{#if renameError}<div class="mt-1 text-[11px] text-error-soft">{renameError}</div>{/if}
								</div>

								<div class="grid gap-3 md:grid-cols-2">
									<div class="rounded-[8px] border border-border-subtle bg-bg-primary p-3">
										<div class="mb-1 text-[10px] uppercase tracking-[0.14em] text-text-placeholder">Space ID</div>
										<button type="button" onclick={() => void copySpaceId()} class="inline-flex max-w-full items-center gap-1 rounded px-1 py-0.5 text-left font-mono text-[12px] text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-secondary" title="Copy space ID"><span class="min-w-0 truncate">{formatCompactId(spaceId)}</span>{#if copiedSpaceId}<Check class="h-3 w-3 shrink-0 text-success-soft" />{:else}<Copy class="h-3 w-3 shrink-0" />{/if}</button>
									</div>
									<div class="rounded-[8px] border border-border-subtle bg-bg-primary p-3">
										<div class="mb-1 text-[10px] uppercase tracking-[0.14em] text-text-placeholder">Public URL</div>
										{#if editingSpaceSlug && canEditSpaceProfile}
											<div class="flex min-w-0 items-center gap-2">
												<div class="flex min-w-0 flex-1 items-center rounded-[5px] border border-brand/40 bg-bg-input px-2.5 py-1.5"><span class="mr-0.5 shrink-0 font-mono text-[12px] {getSpaceOwnerUsername(space) ? 'text-text-tertiary' : 'text-text-placeholder'}">/{getSpaceOwnerUsername(space) || 'username'}/</span><input aria-label="Space slug" bind:value={spaceSlugDraft} placeholder="my-space" maxlength="80" onkeydown={handleSpaceSlugKeydown} disabled={spaceSlugSaving} class="min-w-0 flex-1 bg-transparent font-mono text-[12px] text-text-primary placeholder:text-text-placeholder focus:outline-none" /></div>
												<button type="button" onclick={() => void saveSpaceSlug()} disabled={spaceSlugSaving} class="shrink-0 rounded-[5px] p-1.5 text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-secondary disabled:opacity-50" title="Save slug">{#if spaceSlugSaving}<Loader2 class="h-3.5 w-3.5 animate-spin" />{:else}<Check class="h-3.5 w-3.5" />{/if}</button>
												<button type="button" onclick={cancelSpaceSlugEdit} disabled={spaceSlugSaving} class="shrink-0 rounded-[5px] p-1.5 text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-secondary disabled:opacity-50" title="Cancel"><X class="h-3.5 w-3.5" /></button>
											</div>
											{#if spaceSlugError}<div class="mt-1.5 text-[11px] text-error-soft break-words">{spaceSlugError}</div>{/if}
										{:else}
											<div class="flex min-w-0 items-center gap-1.5 text-[12px] text-text-tertiary">
												{#if getSpacePublicPath(space)}<button type="button" onclick={() => void copySpacePublicLink()} class="group/copy inline-flex min-w-0 items-center gap-1 rounded-[4px] px-1 py-0.5 text-left transition-colors hover:bg-bg-hover hover:text-text-secondary" title="Copy pretty URL"><code class="min-w-0 truncate font-mono">{getSpacePublicPath(space)}</code>{#if copiedSpaceSlugLink}<Check class="h-3 w-3 shrink-0 text-success-soft" />{:else}<Copy class="h-3 w-3 shrink-0" />{/if}</button>{:else if getSpaceSlug(space)}<code class="inline-flex min-w-0 rounded-[4px] px-1 py-0.5 font-mono text-text-tertiary"><span class="text-text-placeholder">/username/</span><span class="min-w-0 truncate">{getSpaceSlug(space)}</span></code>{:else}<button type="button" onclick={beginSpaceSlugEdit} class="min-w-0 truncate rounded-[4px] px-1 py-0.5 text-left text-text-placeholder transition-colors hover:bg-bg-hover hover:text-text-secondary" title="Add space slug">Add space slug</button>{/if}
												{#if canEditSpaceProfile}<button type="button" onclick={beginSpaceSlugEdit} class="shrink-0 rounded-[4px] p-1 text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-secondary" title="Edit slug"><Pencil class="h-3 w-3" /></button>{/if}
											</div>
											{#if getSpacePrettyUrlHint(space)}<p class="mt-1 text-[11px] leading-4 text-text-placeholder">{getSpacePrettyUrlHint(space)}</p>{/if}
										{/if}
									</div>
								</div>

								<label class="block">
									<div class="mb-1.5 text-[12px] font-medium text-text-secondary">Description</div>
									<textarea aria-label="Space description" bind:value={spaceDescriptionDraft} rows="3" maxlength="2000" disabled={!canEditSpaceProfile || spaceDescriptionSaving} onkeydown={handleDescriptionKeydown} class="min-h-20 w-full resize-y rounded-[6px] border border-border-subtle bg-bg-input px-3 py-2 text-[13px] leading-5 text-text-primary placeholder:text-text-placeholder transition-colors focus:border-brand/40 focus:outline-none disabled:opacity-60" placeholder="Describe what this space is for…"></textarea>
								</label>
								{#if canEditSpaceProfile}
									<div class="flex flex-wrap items-center gap-2">
										<button type="button" onclick={() => void saveSpaceDescription()} disabled={spaceDescriptionSaving || spaceDescriptionDraft.trim() === (space?.description ?? '').trim()} class="inline-flex min-h-8 items-center justify-center gap-1.5 rounded-[6px] bg-brand px-3 py-1.5 text-[12px] font-medium text-brand-contrast-fg transition-colors hover:bg-brand-hover disabled:opacity-50">{#if spaceDescriptionSaving}<Loader2 class="h-3.5 w-3.5 animate-spin" /> Saving…{:else}<Check class="h-3.5 w-3.5" /> Save profile{/if}</button>
										<span class="text-[11px] text-text-placeholder">⌘/Ctrl + Enter to save</span>
									</div>
								{/if}
								{#if spaceProfileError}<div class="rounded-[6px] border border-error-soft/30 bg-error-bg px-3 py-2 text-[12px] text-error-soft break-words">{spaceProfileError}</div>{/if}
							</div>
						</div>
					</div>
				</section>

				<section class="overflow-hidden rounded-[10px] border border-border-subtle bg-bg-surface">
					<div class="flex flex-col gap-3 border-b border-border-subtle px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
						<div class="flex min-w-0 items-center gap-2.5">
							<Users class="h-4 w-4 text-text-tertiary" />
							<div class="min-w-0">
								<div class="text-[15px] font-medium text-text-primary">Access</div>
								<div class="text-[12px] text-text-tertiary">Members, permissions, invites.</div>
							</div>
						</div>
						<button type="button" onclick={() => { showInvitePanel = true; inviteCreateError = ""; }} class="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-[6px] border border-brand/20 bg-brand-bg px-3 py-2 text-[12px] font-medium text-brand-muted-fg transition-colors hover:bg-brand-muted"><Link class="h-3.5 w-3.5" /> Invite</button>
					</div>
					<div class="space-y-5 p-4 sm:p-5">
						<div class="grid gap-3 sm:grid-cols-2">
							<label class="block rounded-[8px] border border-border-subtle bg-bg-primary p-3">
								<span class="text-[12px] font-medium text-text-secondary">Signed-in users</span>
								<select value={access?.signed_in_user ?? ""} disabled={!canManageSpaceMembers} onchange={(e) => { const value = (e.currentTarget as HTMLSelectElement).value as SpaceRole | ""; void setAccess({ signed_in_user: value || null }); }} class="mt-2 w-full rounded-[6px] border border-border-subtle bg-bg-input px-2.5 py-2 text-[12px] text-text-primary focus:border-brand/40 focus:outline-none disabled:opacity-60"><option value="">None</option><option value="guest">Guest</option><option value="builder">Builder</option></select>
							</label>
							<label class="block rounded-[8px] border border-border-subtle bg-bg-primary p-3">
								<span class="text-[12px] font-medium text-text-secondary">Anonymous</span>
								<select value={access?.anonymous_user ?? ""} disabled={!canManageSpaceMembers} onchange={(e) => { const value = (e.currentTarget as HTMLSelectElement).value as SpaceRole | ""; void setAccess({ anonymous_user: value || null }); }} class="mt-2 w-full rounded-[6px] border border-border-subtle bg-bg-input px-2.5 py-2 text-[12px] text-text-primary focus:border-brand/40 focus:outline-none disabled:opacity-60"><option value="">None</option><option value="guest">Guest</option></select>
							</label>
						</div>
						{#if accessError}<div class="rounded-[6px] border border-error-soft/30 bg-error-bg px-3 py-2 text-[12px] text-error-soft break-words">{accessError}</div>{/if}

						<div class="space-y-3">
							<div class="flex items-center justify-between gap-3">
								<div class="text-[12px] font-medium text-text-secondary">Members · {members.length}</div>
							</div>
							<div class="flex flex-col gap-2 sm:flex-row">
								<input type="text" bind:value={addingMemberUuid} placeholder="Paste user UUID" disabled={!canManageSpaceMembers} onkeydown={(event) => { if (event.key === 'Enter' && !isComposingKeyboardEvent(event)) { event.preventDefault(); void addMember(); } }} class="min-h-9 min-w-0 flex-1 rounded-[6px] border border-border-subtle bg-bg-input px-3 py-2 font-mono text-[12px] text-text-primary placeholder:text-text-placeholder focus:border-brand/40 focus:outline-none disabled:opacity-60" />
								<div class="grid grid-cols-[1fr_auto] gap-2 sm:flex">
									<select bind:value={addingMemberRole} disabled={!canManageSpaceMembers} class="min-h-9 rounded-[6px] border border-border-subtle bg-bg-input px-2.5 py-2 text-[12px] text-text-secondary focus:border-brand/40 focus:outline-none disabled:opacity-60"><option value="guest">Guest</option><option value="builder">Builder</option><option value="host">Host</option></select>
									<button type="button" onclick={() => { void addMember(); }} disabled={!canManageSpaceMembers || savingMember || !addingMemberUuid.trim()} class="inline-flex min-h-9 min-w-20 items-center justify-center gap-1.5 rounded-[6px] bg-brand px-3 py-2 text-[12px] font-medium text-brand-contrast-fg transition-colors hover:bg-brand-hover disabled:opacity-50">{#if savingMember}<Loader2 class="h-3.5 w-3.5 animate-spin" />{:else}<Plus class="h-3.5 w-3.5" />{/if} Add</button>
								</div>
							</div>
							{#if addingMemberError}<div class="rounded-[6px] border border-error-soft/30 bg-error-bg px-3 py-2 text-[12px] text-error-soft break-words">{addingMemberError}</div>{/if}

							<div class="space-y-1.5">
								{#each members as member (member.userId)}
									<div class="group grid grid-cols-[auto_1fr] gap-2 rounded-[7px] bg-bg-primary px-3 py-2 sm:flex sm:items-center">
										<div class="flex items-center gap-2">
											{#if getMemberRoleIcon(member.role)}<span class="w-3.5 text-center text-[12px]">{getMemberRoleIcon(member.role)}</span>{:else if member.role === 'builder'}<Pencil class="h-3.5 w-3.5 shrink-0 text-brand" />{:else}<Eye class="h-3.5 w-3.5 shrink-0 text-text-tertiary" />{/if}
											<div class="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border-subtle bg-bg-hover-strong text-[10px] font-semibold text-text-tertiary">
												{#if member.profile?.avatarUrl}<img src={member.profile.avatarUrl} alt="" class="h-full w-full object-cover" />{:else}{getInitials(getMemberDisplayName(member))}{/if}
											</div>
										</div>
										<div class="min-w-0">
											<div class="truncate text-[12px] font-medium text-text-secondary">{getMemberDisplayName(member)}</div>
											<button type="button" onclick={() => { void copyMemberUuid(member); }} title="Click to copy user UUID" class="mt-0.5 inline-flex max-w-full items-center gap-1 rounded px-1 py-0.5 text-left font-mono text-[10px] text-text-placeholder transition-colors hover:bg-bg-hover/60 hover:text-text-secondary"><span class="min-w-0 truncate">{getMemberUuid(member)}</span>{#if copiedMemberUserId === member.userId}<Check class="h-3 w-3 shrink-0 text-success-soft" />{/if}</button>
										</div>
										<div class="col-span-2 flex items-center justify-end gap-1 sm:ml-auto sm:shrink-0">
											<select value={member.role} disabled={updatingMemberUserId === member.userId || removingMemberUserId === member.userId} onchange={(event) => { const role = (event.currentTarget as HTMLSelectElement).value as SpaceRole; void updateMemberRole(member.userId, role); }} class="rounded-[5px] bg-transparent px-2 py-1 text-[10px] uppercase tracking-wider text-text-placeholder hover:bg-bg-hover focus:bg-bg-input focus:outline-none disabled:opacity-50"><option value="guest">Guest</option><option value="builder">Builder</option><option value="host">Host</option></select>
											<button type="button" onclick={() => { void removeMember(member.userId); }} disabled={removingMemberUserId === member.userId} title="Remove member" class="inline-flex h-8 w-8 items-center justify-center rounded-[5px] text-text-tertiary transition-colors hover:bg-bg-hover hover:text-error-soft disabled:opacity-50">{#if removingMemberUserId === member.userId}<Loader2 class="h-3 w-3 animate-spin" />{:else}<X class="h-3.5 w-3.5" />{/if}</button>
										</div>
									</div>
								{:else}
									<div class="rounded-[7px] bg-bg-primary px-3 py-2 text-[12px] text-text-tertiary">No members.</div>
								{/each}
							</div>
						</div>

						<div class="border-t border-border-subtle pt-4">
							<div class="mb-2 flex items-center justify-between gap-2">
								<div class="flex items-center gap-2 text-[12px] font-medium text-text-secondary"><Link class="h-3.5 w-3.5 text-text-tertiary" /> Invite links</div>
								<div class="flex items-center gap-2"><button type="button" onclick={() => { void loadInvitations(); }} disabled={loadingInvitations} class="text-[11px] text-text-placeholder hover:text-text-secondary disabled:opacity-50">Refresh</button><span class="text-[11px] text-text-tertiary">{invitations.filter((item) => item.status === 'active').length} active</span></div>
							</div>
							{#if inviteCreateNotice}<div class="mb-2 rounded-[6px] border border-success-soft/30 bg-success-bg px-3 py-2 text-[12px] text-success-soft break-words">{inviteCreateNotice}</div>{/if}
							{#if invitationsError}<div class="mb-2 rounded-[6px] border border-error-soft/30 bg-error-bg px-3 py-2 text-[12px] text-error-soft break-words">{invitationsError}</div>{/if}
							{#if loadingInvitations}
								<div class="flex items-center gap-2 py-2 text-[12px] text-text-tertiary"><Loader2 class="h-3.5 w-3.5 animate-spin" /> Loading invitations…</div>
							{:else if invitations.length === 0}
								<div class="rounded-[7px] bg-bg-primary px-3 py-2 text-[12px] text-text-tertiary">No invite links.</div>
							{:else}
								<div class="space-y-1.5">
									{#each invitations as invitation (invitation.token)}
										<div class="rounded-[7px] border border-border-subtle bg-bg-primary px-3 py-2">
											<div class="flex items-center justify-between gap-3">
												<div class="min-w-0 flex-1"><div class="flex flex-wrap items-center gap-2"><span class="inline-flex rounded bg-brand-bg px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-brand-muted-fg">{invitation.role}</span><span class="text-[11px] text-text-tertiary">{invitation.useCount} use{invitation.useCount !== 1 ? 's' : ''}{invitation.maxUses ? ` / ${invitation.maxUses}` : ''}</span></div><div class="mt-0.5 text-[10px] text-text-placeholder">{invitation.status === 'active' ? formatInviteExpiry(invitation.expiresInSeconds) : invitation.status === 'revoked' ? 'Revoked' : 'All uses exhausted'}</div></div>
												{#if invitation.status === 'active'}<div class="flex shrink-0 items-center gap-1"><button type="button" title="Copy invite link" onclick={() => { void copyInviteLink(invitation.token); }} class="inline-flex h-8 w-8 items-center justify-center rounded-[5px] text-text-tertiary transition-colors hover:bg-bg-hover hover:text-brand">{#if copiedInviteToken === invitation.token}<Check class="h-3.5 w-3.5 text-success-soft" />{:else}<Copy class="h-3.5 w-3.5" />{/if}</button><button type="button" title="Revoke invite" onclick={() => { void revokeInvite(invitation.token); }} class="inline-flex h-8 w-8 items-center justify-center rounded-[5px] text-text-tertiary transition-colors hover:bg-bg-hover hover:text-error-soft"><Trash2 class="h-3.5 w-3.5" /></button></div>{/if}
											</div>
										</div>
									{/each}
								</div>
							{/if}
						</div>
					</div>
				</section>

				{#if showInvitePanel}
					<div class="fixed inset-0 z-50 flex items-center justify-center bg-overlay-scrim p-4" role="presentation" onclick={() => { showInvitePanel = false; }} onkeydown={(event) => { if (event.key === 'Escape') showInvitePanel = false; }}>
						<div class="w-full max-w-sm rounded-[10px] border border-border-subtle bg-bg-surface p-5 shadow-xl" role="dialog" aria-modal="true" tabindex="-1" onclick={(event) => event.stopPropagation()} onkeydown={(event) => event.stopPropagation()}>
							<div class="mb-4 flex items-start justify-between gap-3"><div><h3 class="text-[15px] font-medium text-text-primary">Create invite link</h3><p class="mt-1 text-[12px] text-text-tertiary">Choose a role and expiry.</p></div><button type="button" onclick={() => { showInvitePanel = false; }} class="inline-flex h-8 w-8 items-center justify-center rounded-[5px] text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-secondary"><X class="h-4 w-4" /></button></div>
							{#if inviteCreateError}<div class="mb-3 rounded-[6px] border border-error-soft/30 bg-error-bg px-3 py-2 text-[12px] text-error-soft break-words">{inviteCreateError}</div>{/if}
							<div class="space-y-3"><div><label class="mb-1.5 block text-[10px] font-medium uppercase tracking-wider text-text-tertiary" for="invite-role">Role</label><select id="invite-role" bind:value={inviteRole} class="w-full rounded-[6px] border border-border-subtle bg-bg-input px-3 py-2 text-[13px] text-text-primary focus:border-brand/40 focus:outline-none"><option value="builder">Builder</option><option value="guest">Guest</option><option value="host">Host</option></select></div><div><label class="mb-1.5 block text-[10px] font-medium uppercase tracking-wider text-text-tertiary" for="invite-ttl">Valid for</label><select id="invite-ttl" bind:value={inviteTtlDays} class="w-full rounded-[6px] border border-border-subtle bg-bg-input px-3 py-2 text-[13px] text-text-primary focus:border-brand/40 focus:outline-none"><option value={1}>1 day</option><option value={7}>7 days</option><option value={14}>14 days</option><option value={30}>30 days</option></select></div><div><label class="mb-1.5 block text-[10px] font-medium uppercase tracking-wider text-text-tertiary" for="invite-max-uses">Max uses <span class="normal-case tracking-normal text-text-placeholder">(0 = unlimited)</span></label><input id="invite-max-uses" type="number" bind:value={inviteMaxUses} min="0" max="10000" step="1" class="w-full rounded-[6px] border border-border-subtle bg-bg-input px-3 py-2 text-[13px] text-text-primary focus:border-brand/40 focus:outline-none" /></div></div>
							<div class="mt-5 flex justify-end gap-2"><button type="button" onclick={() => { showInvitePanel = false; }} class="rounded-[6px] border border-border-subtle bg-bg-hover px-4 py-2 text-[12px] text-text-tertiary transition-colors hover:bg-bg-hover-strong hover:text-text-secondary">Cancel</button><button type="button" onclick={() => { void createInvite(); }} disabled={creatingInvite} class="inline-flex items-center gap-1.5 rounded-[6px] bg-brand px-4 py-2 text-[12px] font-medium text-brand-contrast-fg transition-colors hover:bg-brand-hover disabled:opacity-50">{#if creatingInvite}<Loader2 class="h-3.5 w-3.5 animate-spin" /> Creating…{:else}<Link class="h-3.5 w-3.5" /> Create link{/if}</button></div>
						</div>
					</div>
				{/if}

				<section class="overflow-hidden rounded-[10px] border border-border-subtle bg-bg-surface">
					<div class="border-b border-border-subtle px-4 py-3 sm:px-5"><div class="flex items-center gap-2.5"><Terminal class="h-4 w-4 text-text-tertiary" /><div><div class="text-[15px] font-medium text-text-primary">Runtime inputs</div><div class="text-[12px] text-text-tertiary">Env vars and mounted spaces.</div></div></div></div>
					<div class="space-y-6 p-4 sm:p-5">
						<div class="space-y-3">
							<div class="text-[12px] font-medium text-text-secondary">Environment</div>
							<div class="grid gap-2 sm:grid-cols-[160px_1fr_auto]"><input bind:value={envName} disabled={!canEditSpaceProfile} placeholder="NAME" class="min-h-9 min-w-0 rounded-[6px] border border-border-subtle bg-bg-input px-3 py-2 font-mono text-[12px] text-text-primary placeholder:text-text-placeholder focus:border-brand/40 focus:outline-none disabled:opacity-60" /><input bind:value={envValue} disabled={!canEditSpaceProfile} placeholder="value" class="min-h-9 min-w-0 rounded-[6px] border border-border-subtle bg-bg-input px-3 py-2 font-mono text-[12px] text-text-primary placeholder:text-text-placeholder focus:border-brand/40 focus:outline-none disabled:opacity-60" /><button type="button" onclick={addEnv} disabled={!canEditSpaceProfile} class="inline-flex min-h-9 items-center justify-center rounded-[6px] bg-brand px-3 py-2 text-[12px] font-medium text-brand-contrast-fg hover:bg-brand-hover disabled:opacity-50">Add</button></div>
							{#if envError}<div class="rounded-[6px] border border-error-soft/30 bg-error-bg px-3 py-2 text-[12px] text-error-soft break-words">{envError}</div>{/if}
							<div class="space-y-1.5">{#each env as item (item.name)}<div class="grid gap-2 rounded-[7px] bg-bg-primary px-3 py-2 sm:grid-cols-[160px_1fr_auto]"><code class="min-w-0 break-all text-[11px] text-text-primary">{item.name}</code><code class="min-w-0 break-all text-[11px] text-text-tertiary">{revealedEnvNames.has(item.name) ? item.value : '••••••••'}</code><div class="flex gap-3 sm:justify-end"><button type="button" onclick={() => toggleEnvReveal(item.name)} class="text-[11px] text-text-placeholder hover:text-text-secondary">{revealedEnvNames.has(item.name) ? 'Hide' : 'Reveal'}</button><button type="button" onclick={() => removeEnv(item.name)} disabled={!canEditSpaceProfile} class="text-[11px] text-text-placeholder hover:text-error-soft disabled:opacity-50">Remove</button></div></div>{:else}<div class="rounded-[7px] bg-bg-primary px-3 py-2 text-[12px] text-text-tertiary">No variables.</div>{/each}</div>
						</div>

						<div class="border-t border-border-subtle pt-5 space-y-3">
							<div class="flex items-center gap-2 text-[12px] font-medium text-text-secondary"><PackagePlus class="h-3.5 w-3.5 text-text-tertiary" /> Mounted spaces</div>
							<p class="max-w-2xl text-[11px] leading-relaxed text-text-tertiary">Mounted spaces are read-only under <code class="font-mono text-text-secondary">/mods/&lt;slug&gt;</code>. Prompts and skills are available to the agent. Changes restart the sandbox.</p>
							{#if shouldShowBaseModRecommendation && recommendedBaseMod}
								<div class="flex flex-col gap-2 rounded-[7px] border border-border-subtle bg-bg-primary px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
									<div class="min-w-0">
										<div class="flex flex-wrap items-center gap-2">
											<span class="rounded bg-brand-bg px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-brand-muted-fg">Recommended</span>
											<span class="text-[12px] font-medium text-text-secondary">{recommendedBaseMod.name} is not mounted</span>
										</div>
										<div class="mt-1 break-all font-mono text-[10px] text-text-placeholder">/mods/{recommendedBaseMod.mountSlug} · {recommendedBaseMod.modSpaceId}</div>
									</div>
									<button type="button" onclick={() => fillRecommendedMod(recommendedBaseMod)} class="inline-flex min-h-8 shrink-0 items-center justify-center rounded-[6px] border border-border-subtle bg-bg-input px-3 py-1.5 text-[11px] font-medium text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary focus:outline-none focus:ring-1 focus:ring-brand/40">Use recommended mod</button>
								</div>
							{/if}
							<div class="grid gap-2 lg:grid-cols-[1fr_1fr_1fr_auto]"><input bind:value={modSpaceId} disabled={!canManageSpaceMods} placeholder="Mod Space UUID" class="min-h-9 min-w-0 rounded-[6px] border border-border-subtle bg-bg-input px-3 py-2 font-mono text-[12px] text-text-primary placeholder:text-text-placeholder focus:border-brand/40 focus:outline-none disabled:opacity-60" /><input bind:value={modName} disabled={!canManageSpaceMods} placeholder="Display name" class="min-h-9 min-w-0 rounded-[6px] border border-border-subtle bg-bg-input px-3 py-2 text-[12px] text-text-primary placeholder:text-text-placeholder focus:border-brand/40 focus:outline-none disabled:opacity-60" /><input bind:value={modMountSlug} disabled={!canManageSpaceMods} placeholder="Mount slug" class="min-h-9 min-w-0 rounded-[6px] border border-border-subtle bg-bg-input px-3 py-2 font-mono text-[12px] text-text-primary placeholder:text-text-placeholder focus:border-brand/40 focus:outline-none disabled:opacity-60" /><button type="button" onclick={addMod} disabled={!canManageSpaceMods || modSaving || !modSpaceId.trim()} class="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-[6px] bg-brand px-3 py-2 text-[12px] font-medium text-brand-contrast-fg hover:bg-brand-hover disabled:opacity-50">{#if modSaving}<Loader2 class="h-3.5 w-3.5 animate-spin" />{:else}<Plus class="h-3.5 w-3.5" />{/if} Add</button></div>
							{#if modError}<div class="rounded-[6px] border border-error-soft/30 bg-error-bg px-3 py-2 text-[12px] text-error-soft break-words">{modError}</div>{/if}{#if modRestartMessage}<div class="rounded-[6px] border border-success-soft/30 bg-success-bg px-3 py-2 text-[12px] text-success-soft">{modRestartMessage}</div>{/if}
							<div class="space-y-1.5">{#each mods as mod (mod.id)}<div class="grid gap-2 rounded-[7px] bg-bg-primary px-3 py-2 md:grid-cols-[1fr_auto]"><div class="min-w-0"><div class="truncate text-[12px] font-medium text-text-secondary">{mod.name ?? mod.modSpaceName ?? mod.modSpaceId}</div><div class="mt-0.5 break-all font-mono text-[10px] text-text-placeholder">{mod.mountPath} · {mod.modSpaceId}</div><input value={mod.mountSlug} onblur={(event) => { const slug = (event.currentTarget as HTMLInputElement).value.trim(); if (slug !== mod.mountSlug) { void updateModMountSlug(mod, slug); } }} onkeydown={(event) => { if (event.key === 'Enter' && !isComposingKeyboardEvent(event)) { event.preventDefault(); const slug = (event.currentTarget as HTMLInputElement).value.trim(); if (slug !== mod.mountSlug) { void updateModMountSlug(mod, slug); } } }} placeholder="Mount slug" class="mt-2 w-full rounded-[5px] border border-border-subtle bg-bg-input px-2 py-1.5 font-mono text-[11px] text-text-primary placeholder:text-text-placeholder focus:border-brand/40 focus:outline-none" /></div><div class="flex items-center justify-end gap-2 md:justify-start"><span class="rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wider {mod.enabled ? 'bg-success-bg text-success-soft' : 'bg-bg-hover text-text-placeholder'}">{mod.enabled ? 'enabled' : 'disabled'}</span><button type="button" onclick={() => toggleMod(mod)} disabled={!canManageSpaceMods || modUpdatingId === mod.id} class="text-[11px] text-text-placeholder hover:text-text-secondary disabled:opacity-50">{mod.enabled ? 'Disable' : 'Enable'}</button><button type="button" onclick={() => removeMod(mod)} disabled={!canManageSpaceMods || modUpdatingId === mod.id} class="text-[11px] text-text-placeholder hover:text-error-soft disabled:opacity-50">Remove</button></div></div>{:else}<div class="rounded-[7px] bg-bg-primary px-3 py-2 text-[12px] text-text-tertiary">No mounted spaces.</div>{/each}</div>
						</div>
					</div>
				</section>

				<section class="overflow-hidden rounded-[10px] border border-border-subtle bg-bg-surface">
					<div class="border-b border-border-subtle px-4 py-3 sm:px-5"><div class="flex items-center gap-2.5"><Network class="h-4 w-4 text-text-tertiary" /><div><div class="text-[15px] font-medium text-text-primary">Channels</div><div class="text-[12px] text-text-tertiary">External channel bindings.</div></div></div></div>
					<div class="space-y-3 p-4 sm:p-5">
						<div class="grid gap-2 sm:grid-cols-[1fr_auto]"><select bind:value={selectedChannelId} disabled={!canManageSpaceChannels} class="min-h-9 min-w-0 rounded-[6px] border border-border-subtle bg-bg-input px-3 py-2 text-[12px] text-text-primary focus:border-brand/40 focus:outline-none disabled:opacity-60"><option value="">Select channel</option>{#each allChannels.filter((ch) => !channels.some((binding) => binding.channelId === ch.id)) as channel (channel.id)}<option value={channel.id}>{channel.provider} · {channel.name}</option>{/each}</select><button type="button" onclick={bindChannel} disabled={!canManageSpaceChannels || !selectedChannelId} class="inline-flex min-h-9 items-center justify-center rounded-[6px] bg-brand px-3 py-2 text-[12px] font-medium text-brand-contrast-fg hover:bg-brand-hover disabled:opacity-50">Bind</button></div>
						{#if channelError}<div class="rounded-[6px] border border-error-soft/30 bg-error-bg px-3 py-2 text-[12px] text-error-soft break-words">{channelError}</div>{/if}
						<div class="space-y-1.5">{#each channels as binding (binding.id)}<div class="flex items-center justify-between gap-3 rounded-[7px] bg-bg-primary px-3 py-2"><span class="min-w-0 truncate text-[12px] text-text-secondary">{binding.channel?.provider ?? 'channel'} · {binding.channel?.name ?? binding.channelId}</span><button type="button" onclick={() => unbindChannel(binding.channelId)} disabled={!canManageSpaceChannels} class="shrink-0 text-[11px] text-text-placeholder hover:text-error-soft disabled:opacity-50">Unbind</button></div>{:else}<div class="rounded-[7px] bg-bg-primary px-3 py-2 text-[12px] text-text-tertiary">No bound channels.</div>{/each}</div>
					</div>
				</section>

				<section class="overflow-hidden rounded-[10px] border border-border-subtle bg-bg-surface">
					<div class="flex flex-col gap-3 border-b border-border-subtle px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5"><div class="flex min-w-0 items-center gap-2.5"><Settings class="h-4 w-4 text-text-tertiary" /><div class="min-w-0"><div class="text-[15px] font-medium text-text-primary">Sandbox</div><div class="text-[12px] text-text-tertiary">Policy, health, runtime image.</div></div></div><button type="button" onclick={forceRecoverSandbox} disabled={!canManageSpaceSandbox || recoveringSandbox} class="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-[6px] border border-border-subtle bg-bg-input px-3 py-2 text-[12px] text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary disabled:opacity-50">{#if recoveringSandbox}<Loader2 class="h-3.5 w-3.5 animate-spin" /> Recovering{:else}<RefreshCw class="h-3.5 w-3.5" /> Force recover{/if}</button></div>
					<div class="space-y-5 p-4 sm:p-5">
						<div class="rounded-[8px] border border-border-subtle bg-bg-primary p-3">
							<div class="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"><div><div class="text-[12px] font-medium text-text-secondary">Hibernate policy</div><div class="mt-0.5 text-[11px] text-text-tertiary">Current: {sandboxAutoDestroyMode === "never" ? "Never" : formatTtl(sandboxIdleTtlSeconds)}</div></div><button type="button" onclick={saveSandboxConfig} disabled={!canManageSpaceSandbox || savingSandboxConfig} class="inline-flex min-h-9 items-center justify-center rounded-[6px] bg-brand px-3 py-2 text-[12px] font-medium text-brand-contrast-fg hover:bg-brand-hover disabled:opacity-50">{savingSandboxConfig ? "Saving…" : "Save policy"}</button></div>
							<div class="grid grid-cols-1 gap-2 md:grid-cols-[180px_1fr]"><select bind:value={sandboxAutoDestroyMode} class="min-h-9 w-full rounded-[6px] border border-border-subtle bg-bg-input px-3 py-2 text-[13px] text-text-primary focus:border-brand/40 focus:outline-none"><option value="idle">Hibernate when idle</option><option value="never">Never hibernate</option></select>{#if sandboxAutoDestroyMode === "idle"}<div class="grid gap-2 sm:grid-cols-[1fr_auto]"><input type="number" min="60" max="2592000" step="60" bind:value={sandboxIdleTtlSeconds} class="min-h-9 w-full rounded-[6px] border border-border-subtle bg-bg-input px-3 py-2 text-[13px] text-text-primary focus:border-brand/40 focus:outline-none" /><span class="self-center text-[12px] text-text-tertiary">seconds · max 30d</span></div>{:else}<div class="rounded-[6px] border border-border-subtle bg-bg-input px-3 py-2 text-[13px] text-text-tertiary">Sandbox stays online until hibernated or replaced.</div>{/if}</div>
							{#if sandboxConfigError}<div class="mt-2 text-[12px] text-error-soft">{sandboxConfigError}</div>{/if}{#if sandboxConfigMessage}<div class="mt-2 text-[12px] text-success-soft">{sandboxConfigMessage}</div>{/if}
						</div>

						<div class="grid gap-3 lg:grid-cols-[1.15fr_0.85fr]">
							<div class="rounded-[8px] bg-bg-primary p-3 ring-1 ring-border-subtle"><div class="flex flex-wrap items-center gap-2"><span class={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${getSandboxStatusClass(sandbox?.status)}`}>{getSandboxLifecycleLabel(sandbox?.status)}</span><span class={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${getSandboxStatusClass(sandbox?.runtimeStatus)}`}>{getSandboxRuntimeLabel(sandbox?.runtimeStatus)}</span>{#if sandbox?.stopReason}<span class="inline-flex max-w-full items-center rounded-full bg-bg-hover px-2 py-0.5 text-[11px] text-text-tertiary ring-1 ring-border-subtle"><span class="truncate">{sandbox.stopReason}</span></span>{/if}</div><div class="mt-4 grid grid-cols-1 gap-3 text-[12px] sm:grid-cols-2"><div title={getSandboxActivityTitle()}><div class="text-[10px] uppercase tracking-[0.14em] text-text-placeholder">Activity</div><div class="mt-1 text-text-primary">{getSandboxActivityText()}</div></div><div title={getSandboxHeartbeatTitle()}><div class="text-[10px] uppercase tracking-[0.14em] text-text-placeholder">Heartbeat</div><div class="mt-1 text-text-primary">{formatRelativeTime(sandbox?.lastHeartbeatAt)}</div></div><div><div class="text-[10px] uppercase tracking-[0.14em] text-text-placeholder">Stopped at</div><div class="mt-1 text-text-primary">{formatRelativeTime(sandbox?.stoppedAt)}</div><div class="mt-0.5 break-words text-[11px] text-text-placeholder">{formatTime(sandbox?.stoppedAt)}</div></div><div class="min-w-0"><div class="text-[10px] uppercase tracking-[0.14em] text-text-placeholder">Pod</div><div class="mt-1 min-w-0 break-all font-mono text-[11px] text-text-primary">{sandbox?.podName ?? '—'}</div><div class="mt-0.5 break-all text-[11px] text-text-placeholder">{getSandboxMetaValue('podIp') || 'IP unavailable'}</div></div></div></div>
							<div class="grid grid-cols-1 gap-2 text-[12px] sm:grid-cols-2 lg:grid-cols-1"><div class="min-w-0 rounded-[8px] bg-bg-primary px-3 py-2 ring-1 ring-border-subtle"><div class="text-text-placeholder">Desired image</div><div class="mt-0.5 min-w-0 break-all font-mono text-[11px] leading-relaxed text-text-primary">{sandbox?.desiredImage ?? '—'}</div></div><div class="min-w-0 rounded-[8px] bg-bg-primary px-3 py-2 ring-1 ring-border-subtle"><div class="text-text-placeholder">Reported image</div><div class="mt-0.5 min-w-0 break-all font-mono text-[11px] leading-relaxed text-text-primary">{(sandbox?.reportedImageVersion ?? getSandboxMetaValue('imageVersion')) || '—'}</div></div><div class="rounded-[8px] bg-bg-primary px-3 py-2 ring-1 ring-border-subtle"><div class="text-text-placeholder">Report refreshed</div><div class="mt-0.5 text-text-primary">{formatRelativeTime(sandbox?.reportedAt)}</div></div></div>
						</div>
						{#if sandboxRecoveryMessage}<div class="rounded-[6px] border border-success-soft/30 bg-success-bg px-3 py-2 text-[12px] text-success-soft">{sandboxRecoveryMessage}</div>{/if}{#if sandboxRecoveryError}<div class="rounded-[6px] border border-error-soft/30 bg-error-bg px-3 py-2 text-[12px] text-error-soft break-words">{sandboxRecoveryError}</div>{/if}
					</div>
				</section>
			{/if}
		</div>
	</main>
</div>
