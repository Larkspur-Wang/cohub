<script lang="ts">
import type { Permission, WorkRecord, WorkTargetType } from "@neta-art/cohub";
import { Check, Copy, Loader2 } from "lucide-svelte";
import Dialog from "$lib/components/Dialog.svelte";
import { sdk } from "$lib/sdk";

const {
	open,
	spaceId,
	ownerUsername,
	spaceSlug,
	targetType,
	targetRef,
	onClose,
}: {
	open: boolean;
	spaceId: string;
	ownerUsername: string | null;
	spaceSlug: string | null;
	targetType: WorkTargetType;
	targetRef: string;
	onClose: () => void;
} = $props();

let name = $state("");
let slug = $state("");
let publishing = $state(false);
let error = $state<string | null>(null);
let published = $state<WorkRecord | null>(null);
let copied = $state(false);

const workScopes = $state<Record<string, boolean>>({
	"space.view": true,
	"session.view": false,
});
const allowedViewerScopes = $state<Record<string, boolean>>({
	"session.prompt.readonly": true,
	"session.prompt.fullaccess": false,
});
const workUrl = $derived.by(() => {
	if (!ownerUsername || !spaceSlug || !published) return "";
	return `${window.location.origin}/${ownerUsername}/${spaceSlug}/w/${published.slug}`;
});

$effect(() => {
	if (!open) return;
	if (!name) {
		const base =
			targetRef
				.split("/")
				.filter(Boolean)
				.pop()
				?.replace(/\.[^.]+$/, "") || "work";
		name = base.replace(/[-_]+/g, " ").replace(/\b\w/g, (v) => v.toUpperCase());
		slug = slugify(base);
	}
});

function slugify(value: string) {
	return (
		value
			.trim()
			.toLowerCase()
			.replace(/[^a-z0-9_-]+/g, "-")
			.replace(/^-+|-+$/g, "")
			.slice(0, 80) || "work"
	);
}

function selectedScopes(source: Record<string, boolean>) {
	return Object.entries(source)
		.filter(([, enabled]) => enabled)
		.map(([scope]) => scope as Permission);
}

async function publish() {
	if (!ownerUsername || !spaceSlug) {
		error = "Set a space slug before publishing.";
		return;
	}
	publishing = true;
	error = null;
	try {
		const result = await sdk.works.create({
			spaceId,
			name: name.trim() || "Untitled work",
			slug: slugify(slug || name),
			status: "published",
			targetType,
			targetRef,
			workScopes: selectedScopes(workScopes),
			allowedViewerScopes: selectedScopes(allowedViewerScopes),
		});
		published = result.work;
	} catch (err) {
		error = err instanceof Error ? err.message : "Publish failed.";
	} finally {
		publishing = false;
	}
}

async function copyUrl() {
	if (!workUrl) return;
	await navigator.clipboard.writeText(workUrl);
	copied = true;
	setTimeout(() => (copied = false), 1400);
}
</script>

<Dialog {open} onClose={onClose} title="Publish work" maxWidth="520px">
	<div class="space-y-5 p-4">
		{#if published}
			<div class="space-y-3">
				<div>
					<div class="text-sm font-medium text-text-primary">Work published</div>
					<div class="mt-1 text-xs text-text-tertiary">Share this URL with viewers.</div>
				</div>
				<div class="flex items-center gap-2 rounded-md border border-border-subtle bg-bg-input p-2">
					<div class="min-w-0 flex-1 truncate font-mono text-xs text-text-secondary">{workUrl}</div>
					<button type="button" class="icon-btn" onclick={() => void copyUrl()} title="Copy link">
						{#if copied}<Check class="h-4 w-4 text-success-soft" />{:else}<Copy class="h-4 w-4" />{/if}
					</button>
				</div>
				<div class="flex justify-end gap-2">
					<a class="action-btn" href={workUrl} target="_blank" rel="noreferrer">Open</a>
					<button type="button" class="action-btn primary" onclick={onClose}>Done</button>
				</div>
			</div>
		{:else}
			<div class="grid gap-3">
				<label class="grid gap-1.5">
					<span class="text-[11px] font-medium uppercase tracking-wide text-text-tertiary">Name</span>
					<input class="form-input" bind:value={name} placeholder="Agent dashboard" />
				</label>
				<label class="grid gap-1.5">
					<span class="text-[11px] font-medium uppercase tracking-wide text-text-tertiary">Slug</span>
					<input class="form-input font-mono" bind:value={slug} oninput={() => slug = slugify(slug)} placeholder="agent-dashboard" />
					<div class="text-[11px] text-text-placeholder">/{ownerUsername ?? "user"}/{spaceSlug ?? "space"}/w/{slug || "work"}</div>
				</label>
			</div>

			<div class="rounded-md border border-border-subtle bg-bg-surface p-3">
				<div class="mb-1 text-[11px] font-medium uppercase tracking-wide text-text-tertiary">Source</div>
				<div class="truncate font-mono text-xs text-text-secondary">{targetType}: {targetRef}</div>
			</div>

			<div class="grid gap-3 sm:grid-cols-2">
				<div class="space-y-2">
					<div class="text-[11px] font-medium uppercase tracking-wide text-text-tertiary">Work can</div>
					<label class="permission-row"><input type="checkbox" bind:checked={workScopes["space.view"]} /> View space</label>
					<label class="permission-row"><input type="checkbox" bind:checked={workScopes["session.view"]} /> View sessions</label>
				</div>
				<div class="space-y-2">
					<div class="text-[11px] font-medium uppercase tracking-wide text-text-tertiary">Viewers can allow</div>
					<label class="permission-row"><input type="checkbox" bind:checked={allowedViewerScopes["session.prompt.readonly"]} /> Prompt read-only</label>
					<label class="permission-row"><input type="checkbox" bind:checked={allowedViewerScopes["session.prompt.fullaccess"]} /> Prompt full access</label>
				</div>
			</div>

			{#if error}<div class="rounded-md border border-error-soft/30 bg-error-bg p-2 text-xs text-error-soft">{error}</div>{/if}
			<div class="flex justify-end gap-2 border-t border-border-subtle pt-3">
				<button type="button" class="action-btn" onclick={onClose}>Cancel</button>
				<button type="button" class="action-btn primary" onclick={() => void publish()} disabled={publishing}>
					{#if publishing}<Loader2 class="h-3.5 w-3.5 animate-spin" />{/if}
					Publish
				</button>
			</div>
		{/if}
	</div>
</Dialog>

<style>
	.form-input { height: 34px; border-radius: 7px; border: 1px solid var(--border-subtle); background: var(--bg-input); padding: 0 10px; color: var(--text-primary); font-size: 13px; outline: none; }
	.form-input:focus { border-color: var(--brand); }
	.permission-row { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--text-secondary); }
</style>
