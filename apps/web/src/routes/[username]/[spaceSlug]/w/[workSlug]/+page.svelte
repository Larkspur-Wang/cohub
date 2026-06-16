<script lang="ts">
import { AlertTriangle, Check, Loader2, ShieldCheck } from "lucide-svelte";
import { onDestroy, onMount } from "svelte";
import { page } from "$app/state";
import { PUBLIC_API_ORIGIN } from "$env/static/public";
import { getAuthToken, signInWithRedirectPath } from "$lib/auth";
import Dialog from "$lib/components/Dialog.svelte";
import SpaceAvatar from "$lib/components/SpaceAvatar.svelte";

const props = $props<{
	data: {
		work: {
			id: string;
			spaceId: string;
			slug: string;
			targetType: "file" | "directory" | "port";
			targetRef: string;
			workScopes: string[];
			allowedViewerScopes: string[];
		};
		space?: {
			id: string;
			slug: string | null;
			name: string | null;
			userUuid: string;
			publicProfile?: { avatarUrl: string | null } | null;
		};
		owner: {
			username: string | null;
			displayName: string;
			avatarUrl?: string | null;
		} | null;
		content: { url?: string; targetType?: string; path?: string } | null;
	};
}>();

let frame: HTMLIFrameElement | null = $state(null);
let workToken = $state<string | null>(null);
let authOpen = $state(false);
let pendingAuth = $state<{
	requestId: string;
	scopes: string[];
	reason?: string;
} | null>(null);
let authError = $state<string | null>(null);
let authSaving = $state(false);

const work = $derived(props.data.work);
const space = $derived(props.data.space ?? null);
const spaceName = $derived(space?.name || space?.slug || "Space");
const publisherName = $derived(props.data.owner?.displayName ?? "Cohub");
const publisherAvatarUrl = $derived(
	props.data.owner?.avatarUrl?.trim() || null,
);
const iframeSrc = $derived.by(
	() =>
		props.data.content?.url ??
		(work.targetType === "port" ? work.targetRef : ""),
);
function isAllowedFrameOrigin(origin: string, targetType: string) {
	try {
		const { protocol, hostname } = new URL(origin);
		if (protocol !== "https:") return false;
		if (targetType === "port")
			return hostname === "cohub.run" || hostname.endsWith(".cohub.run");
		return true;
	} catch {
		return false;
	}
}

const frameOrigin = $derived.by(() => {
	if (!iframeSrc) return null;
	try {
		const origin = new URL(iframeSrc, page.url).origin;
		return isAllowedFrameOrigin(origin, work.targetType) ? origin : null;
	} catch {
		return null;
	}
});
const frameReplyTarget = $derived(frameOrigin ?? page.url.origin);
const framePreconnectOrigin = $derived.by(() => {
	if (!frameOrigin || frameOrigin === page.url.origin) return null;
	return frameOrigin;
});
const frameSandbox =
	"allow-scripts allow-same-origin allow-forms allow-popups allow-downloads allow-modals";

async function ensureBaseToken(forceRefresh = false) {
	if (workToken && !forceRefresh) return workToken;
	const userToken = await getAuthToken({ forceRefresh });
	if (!userToken) {
		await signInWithRedirectPath(location.pathname);
		return null;
	}
	const response = await fetch(
		`${PUBLIC_API_ORIGIN ?? ""}/api/works/${work.id}/session`,
		{
			method: "POST",
			headers: { Authorization: `Bearer ${userToken}` },
		},
	);
	if (!response.ok) throw new Error("Failed to create work session.");
	const result = await response.json();
	workToken = result.token;
	return workToken;
}

async function authorize(scopes: string[]) {
	const userToken = await getAuthToken();
	if (!userToken) {
		await signInWithRedirectPath(location.pathname);
		return null;
	}
	const response = await fetch(
		`${PUBLIC_API_ORIGIN ?? ""}/api/works/${work.id}/authorize`,
		{
			method: "POST",
			headers: {
				Authorization: `Bearer ${userToken}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ scopes }),
		},
	);
	if (!response.ok)
		throw new Error(
			(await response.json().catch(() => null))?.message ??
				"Authorization failed.",
		);
	const result = await response.json();
	workToken = result.token;
	return workToken;
}

function reply(requestId: string, payload: Record<string, unknown>) {
	if (!frameOrigin) return;
	frame?.contentWindow?.postMessage(
		{ requestId, ...payload },
		frameReplyTarget,
	);
}

function profileInitials(value: string | null | undefined) {
	const text = (value ?? "").replace(/[-_]/g, " ").replace(/\s+/g, " ").trim();
	if (!text) return "CO";
	const parts = text.split(" ").filter(Boolean);
	const letters =
		parts.length >= 2
			? `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}`
			: text.slice(0, 2);
	return letters.toUpperCase();
}

function formatScopeLabel(scope: string) {
	const labels: Record<string, string> = {
		"session.prompt.readonly": "Prompt read-only",
		"session.prompt.fullaccess": "Prompt full access",
		"generation.create": "Create generations",
		"file.view": "View files",
		"taskrun.view": "View task runs",
	};
	return labels[scope] ?? scope;
}

function formatScopeDescription(scope: string) {
	const descriptions: Record<string, string> = {
		"session.prompt.readonly":
			"Read prompts and session context without making changes.",
		"session.prompt.fullaccess":
			"Send prompts and act in the session with your approval.",
		"generation.create": "Start image, video, or other generation tasks.",
		"file.view": "Read files in this space.",
		"taskrun.view": "View task progress and results in this space.",
	};
	return (
		descriptions[scope] ?? "Grant this work the requested Cohub permission."
	);
}

function replyAuthCancel() {
	if (authSaving) return;
	if (!pendingAuth) return;
	reply(pendingAuth.requestId, {
		type: "cohub.work.authorize.result",
		token: null,
	});
	authOpen = false;
	pendingAuth = null;
	authError = null;
	authSaving = false;
}

async function handleMessage(event: MessageEvent) {
	if (event.source !== frame?.contentWindow) return;
	if (frameOrigin && event.origin !== frameOrigin) return;
	const data = event.data as {
		type?: string;
		requestId?: string;
		scopes?: string[];
		reason?: string;
		forceRefresh?: boolean;
	};
	if (!data?.requestId) return;
	try {
		if (!frameOrigin) return;
		if (data.type === "cohub.work.context") {
			reply(data.requestId, {
				type: "cohub.work.context.result",
				context: {
					work: {
						id: work.id,
						slug: work.slug,
						url: location.href,
					},
					space: { id: work.spaceId },
					permissions: {
						scopes: work.workScopes,
						workScopes: work.workScopes,
						viewerScopes: [],
					},
				},
			});
		}
		if (data.type === "cohub.work.token") {
			const token = await ensureBaseToken(Boolean(data.forceRefresh));
			reply(data.requestId, { type: "cohub.work.token.result", token });
		}
		if (data.type === "cohub.work.authorize") {
			const scopes = (data.scopes ?? []).filter((scope) =>
				work.allowedViewerScopes.includes(scope),
			);
			if (scopes.length === 0) {
				reply(data.requestId, {
					type: "cohub.work.error",
					message: "No allowed scopes requested.",
				});
				return;
			}
			pendingAuth = {
				requestId: data.requestId,
				scopes,
				reason: data.reason,
			};
			authError = null;
			authOpen = true;
		}
	} catch (error) {
		reply(data.requestId, {
			type: "cohub.work.error",
			message: error instanceof Error ? error.message : "Request failed.",
		});
	}
}

async function confirmAuth() {
	if (!pendingAuth || authSaving) return;
	authError = null;
	authSaving = true;
	try {
		const token = await authorize(pendingAuth.scopes);
		reply(pendingAuth.requestId, {
			type: "cohub.work.authorize.result",
			token,
		});
		authOpen = false;
		pendingAuth = null;
	} catch (error) {
		authError =
			error instanceof Error ? error.message : "Authorization failed.";
	} finally {
		authSaving = false;
	}
}

onMount(() => window.addEventListener("message", handleMessage));
onDestroy(() => window.removeEventListener("message", handleMessage));
</script>

<svelte:head>
	<title>{work.slug} · Cohub</title>
	{#if framePreconnectOrigin}
		<link rel="preconnect" href={framePreconnectOrigin} crossorigin="anonymous" />
	{/if}
</svelte:head>

<div class="relative min-h-screen overflow-hidden bg-bg-content text-text-primary">
	{#if iframeSrc}
		<iframe
			bind:this={frame}
			class="h-screen w-full border-0 bg-bg-primary"
			title={work.slug}
			sandbox={frameSandbox}
			src={iframeSrc}
		></iframe>
	{:else}
		<div class="flex h-screen items-center justify-center p-6 text-sm text-text-tertiary">
			Work asset is unavailable.
		</div>
	{/if}

	<footer class="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex justify-center px-3 pb-3 sm:pb-4">
		<div class="work-bar pointer-events-auto flex h-12 w-full max-w-[860px] items-center gap-3 rounded-lg border border-border-subtle bg-bg-surface/95 px-2.5 text-[11px] text-text-tertiary shadow-lg shadow-bg-primary/15 backdrop-blur-md supports-[not(backdrop-filter:blur(0))]:bg-bg-surface sm:px-3">
			<div class="flex min-w-0 flex-1 items-center gap-2.5 overflow-hidden">
				<img src="/favicon.svg" alt="Cohub" class="block h-5 w-5 shrink-0 rounded-[5px]" />
				<div class="hidden h-4 w-px shrink-0 bg-border-subtle sm:block"></div>
				<div class="flex min-w-0 items-center gap-2 overflow-hidden">
					<SpaceAvatar name={spaceName} profile={space?.publicProfile} size="xs" class="translate-y-0" />
					<span class="min-w-0 truncate font-medium leading-none text-text-secondary">{spaceName}</span>
					<span class="hidden shrink-0 leading-none text-text-tertiary sm:inline">/</span>
					<span class="hidden min-w-0 truncate font-medium leading-none text-text-primary sm:inline">{work.slug}</span>
				</div>
			</div>
			<div class="flex shrink-0 items-center gap-2">
				<div class="flex min-w-0 items-center gap-2 overflow-hidden">
					<span class="hidden shrink-0 leading-none text-text-tertiary md:inline">Published by</span>
					<span class="inline-flex h-5 w-5 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border-subtle bg-bg-elevated text-[8px] font-semibold leading-none text-text-secondary shadow-[inset_0_1px_0_var(--color-border-subtle)]">
						{#if publisherAvatarUrl}
							<img src={publisherAvatarUrl} alt="" class="block h-full w-full object-cover" loading="lazy" />
						{:else}
							<span>{profileInitials(publisherName)}</span>
						{/if}
					</span>
					<span class="hidden max-w-32 truncate font-medium leading-none text-text-secondary sm:inline">{publisherName}</span>
				</div>
				<button type="button" class="inline-flex h-8 shrink-0 items-center justify-center rounded-md px-2.5 font-medium leading-none text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60 disabled:pointer-events-none disabled:opacity-50">
					Remix
				</button>
			</div>
		</div>
	</footer>
</div>

<Dialog open={authOpen && !!pendingAuth} onClose={replyAuthCancel} title="Work access" maxWidth="440px">
	{#if pendingAuth}
		<div class="auth-panel">
			<div class="auth-intro">
				<div class="auth-icon"><ShieldCheck class="h-4 w-4" /></div>
				<div class="min-w-0">
					<div class="auth-title">Allow work access?</div>
					<p class="auth-copy">{pendingAuth.reason || "This work wants to use Cohub on your behalf."}</p>
				</div>
			</div>

			<section class="auth-section">
				<div class="auth-section-label">Requested permissions</div>
				<div class="auth-scope-list">
					{#each pendingAuth.scopes as scope}
						<div class="auth-scope-row">
							<div class="auth-scope-check"><Check class="h-3 w-3" /></div>
							<div class="min-w-0">
								<div class="auth-scope-name">{formatScopeLabel(scope)}</div>
								<div class="auth-scope-description">{formatScopeDescription(scope)}</div>
							</div>
						</div>
					{/each}
				</div>
			</section>

			{#if authError}
				<div class="auth-error"><AlertTriangle class="h-3.5 w-3.5" />{authError}</div>
			{/if}

			<div class="auth-actions">
				<button type="button" class="auth-button secondary" onclick={replyAuthCancel} disabled={authSaving}>Cancel</button>
				<button type="button" class="auth-button primary" onclick={() => void confirmAuth()} disabled={authSaving}>
					{#if authSaving}<Loader2 class="h-3.5 w-3.5 animate-spin" />{:else}<ShieldCheck class="h-3.5 w-3.5" />{/if}
					Allow access
				</button>
			</div>
		</div>
	{/if}
</Dialog>

<style>
	.work-bar {
		max-width: min(860px, calc(100vw - 24px));
	}

	.auth-panel {
		display: grid;
		gap: 14px;
		padding: 16px;
	}

	.auth-intro {
		display: flex;
		align-items: flex-start;
		gap: 12px;
	}

	.auth-icon {
		display: grid;
		width: 32px;
		height: 32px;
		flex: 0 0 auto;
		place-items: center;
		border-radius: 8px;
		background: color-mix(in srgb, var(--brand) 14%, var(--bg-surface));
		color: var(--brand);
		box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--brand) 28%, transparent);
	}

	.auth-title {
		font-size: 15px;
		font-weight: 600;
		line-height: 1.25;
		color: var(--text-primary);
	}

	.auth-copy {
		margin-top: 5px;
		font-size: 13px;
		line-height: 1.5;
		color: var(--text-secondary);
	}

	.auth-section {
		display: grid;
		gap: 8px;
	}

	.auth-section-label {
		font-size: 10px;
		font-weight: 600;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--text-tertiary);
	}

	.auth-scope-list {
		display: grid;
		gap: 8px;
	}

	.auth-scope-row {
		display: flex;
		align-items: flex-start;
		gap: 9px;
		min-width: 0;
		border: 1px solid var(--border-subtle);
		border-radius: 8px;
		background: var(--bg-surface);
		padding: 10px;
	}

	.auth-scope-check {
		display: grid;
		width: 18px;
		height: 18px;
		flex: 0 0 auto;
		place-items: center;
		border-radius: 5px;
		background: color-mix(in srgb, var(--brand) 12%, var(--bg-input));
		color: var(--brand);
	}

	.auth-scope-name {
		font-size: 12px;
		font-weight: 500;
		line-height: 1.25;
		color: var(--text-primary);
	}

	.auth-scope-description {
		margin-top: 3px;
		font-size: 11px;
		line-height: 1.45;
		color: var(--text-tertiary);
	}

	.auth-error {
		display: flex;
		align-items: flex-start;
		gap: 7px;
		border-radius: 6px;
		border: 1px solid color-mix(in srgb, var(--error-soft) 30%, transparent);
		background: var(--error-bg);
		padding: 8px 10px;
		font-size: 12px;
		line-height: 1.4;
		color: var(--error-soft);
	}

	.auth-error :global(svg) {
		flex: 0 0 auto;
		margin-top: 1px;
	}

	.auth-actions {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
		border-top: 1px solid var(--border-subtle);
		padding-top: 12px;
	}

	.auth-button {
		display: inline-flex;
		min-height: 34px;
		align-items: center;
		justify-content: center;
		gap: 7px;
		border-radius: 6px;
		padding: 0 12px;
		font-size: 12px;
		font-weight: 500;
		line-height: 1;
		transition: background 120ms ease, border-color 120ms ease, color 120ms ease, opacity 120ms ease;
	}

	.auth-button:focus-visible {
		outline: 2px solid color-mix(in srgb, var(--brand) 60%, transparent);
		outline-offset: 2px;
	}

	.auth-button:disabled {
		cursor: not-allowed;
		opacity: 0.55;
	}

	.auth-button.primary {
		border: 1px solid var(--brand);
		background: var(--brand);
		color: var(--brand-contrast-fg);
	}

	.auth-button.primary:hover:not(:disabled) {
		opacity: 0.92;
	}

	.auth-button.secondary {
		border: 1px solid var(--border-subtle);
		background: var(--bg-surface);
		color: var(--text-secondary);
	}

	.auth-button.secondary:hover:not(:disabled) {
		background: var(--bg-hover);
		color: var(--text-primary);
	}

	@media (max-width: 420px) {
		.work-bar {
			gap: 0.5rem;
		}

		.auth-actions {
			grid-template-columns: 1fr 1fr;
			display: grid;
		}

		.auth-button {
			min-height: 44px;
			font-size: 13px;
		}
	}
</style>
