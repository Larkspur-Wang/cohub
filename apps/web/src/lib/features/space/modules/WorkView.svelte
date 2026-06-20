<script lang="ts">
import type { WorkRecord, WorkVersionRecord } from "@neta-art/cohub";
import {
	Check,
	Copy,
	ExternalLink,
	Loader2,
	Pencil,
	Power,
	PowerOff,
	Rocket,
	Trash2,
} from "lucide-svelte";
import { onDestroy } from "svelte";
import { goto } from "$app/navigation";
import CenteredLoading from "$lib/components/CenteredLoading.svelte";
import { sdk } from "$lib/sdk";
import { buildSpaceLandingRoute } from "$lib/space-routes";
import { formatDateTime } from "../space-utils";
import {
	scopeState,
	selectedScopeList,
	WORK_SCOPE_OPTIONS,
	WORK_VIEWER_SCOPE_OPTIONS,
	workStatusTone,
} from "./work-utils";

type Props = {
	spaceId: string;
	routeWorkId: string | null;
	ownerUsername: string | null;
	spaceSlug: string | null;
	onDetailLoaded?: (work: WorkRecord | null) => void;
};

let { spaceId, routeWorkId, ownerUsername, spaceSlug, onDetailLoaded }: Props =
	$props();

let workDetail = $state<WorkRecord | null>(null);
let workDetailLoading = $state(false);
let workDetailError = $state("");
let workActionInProgress = $state(false);
let workDeleteInProgress = $state(false);
let workEditMode = $state(false);
let workFormSlug = $state("");
let workFormTargetType = $state<"file" | "directory" | "port">("file");
let workFormTargetRef = $state("");
let workFormStatus = $state<"draft" | "published" | "disabled">("published");
let workFormScopes = $state<Record<string, boolean>>({});
let workFormViewerScopes = $state<Record<string, boolean>>({});
let workFormSubmitting = $state(false);
let workFormError = $state("");
let workCopiedId = $state(false);
let workCopiedIdTimer: ReturnType<typeof setTimeout> | null = null;
let workRouteStateKey = "";
let workVersions = $state<WorkVersionRecord[]>([]);
let workVersionsLoading = $state(false);
let workVersionsError = $state("");
let workPublishTargetType = $state<"file" | "directory" | "port">("file");
let workPublishTargetRef = $state("");
let workPublishSubmitting = $state(false);
let workPublishError = $state("");

function syncWorkFormFromDetail() {
	if (!workDetail) return;
	workFormSlug = workDetail.slug;
	workFormTargetType = workDetail.targetType;
	workFormTargetRef = workDetail.targetRef;
	workFormStatus = workDetail.status;
	workFormScopes = scopeState(workDetail.workScopes, WORK_SCOPE_OPTIONS);
	workFormViewerScopes = scopeState(
		workDetail.allowedViewerScopes,
		WORK_VIEWER_SCOPE_OPTIONS,
	);
	workFormError = "";
	workPublishTargetType = workDetail.targetType;
	workPublishTargetRef = workDetail.targetRef;
	workPublishError = "";
}

function notifyWorksUpdated() {
	if (typeof window === "undefined") return;
	window.dispatchEvent(
		new CustomEvent("cohub:works-changed", { detail: { spaceId } }),
	);
}

function workPublicRoute(work: WorkRecord | null = workDetail) {
	return ownerUsername && spaceSlug && work?.slug
		? `/${encodeURIComponent(ownerUsername)}/${encodeURIComponent(spaceSlug)}/w/${encodeURIComponent(work.slug)}`
		: null;
}

async function loadWorkDetail(workId: string) {
	const requestSpaceId = spaceId;
	const isCurrentRequest = () =>
		spaceId === requestSpaceId && routeWorkId === workId;
	workDetailLoading = true;
	workDetailError = "";
	try {
		const { work } = await sdk.works.get(workId);
		if (!isCurrentRequest()) return;
		workDetail = work;
		onDetailLoaded?.(work);
		syncWorkFormFromDetail();
		void loadWorkVersions(work.id);
	} catch (error) {
		if (!isCurrentRequest()) return;
		workDetail = null;
		onDetailLoaded?.(null);
		workDetailError =
			error instanceof Error ? error.message : "Failed to load work";
	} finally {
		if (isCurrentRequest()) workDetailLoading = false;
	}
}

async function loadWorkVersions(workId: string) {
	workVersionsLoading = true;
	workVersionsError = "";
	try {
		const { versions } = await sdk.works.listVersions(workId);
		if (routeWorkId === workId) workVersions = versions;
	} catch (error) {
		if (routeWorkId === workId) {
			workVersionsError =
				error instanceof Error ? error.message : "Failed to load versions";
		}
	} finally {
		if (routeWorkId === workId) workVersionsLoading = false;
	}
}

async function onPublishWorkVersion() {
	if (!workDetail || workPublishSubmitting) return;
	workPublishError = "";
	if (!workPublishTargetRef.trim()) {
		workPublishError = "Target is required";
		return;
	}
	workPublishSubmitting = true;
	try {
		const { work } = await sdk.works.update(workDetail.id, {
			status: "published",
			targetType: workPublishTargetType,
			targetRef: workPublishTargetRef.trim(),
			publishVersion: true,
		});
		workDetail = work;
		onDetailLoaded?.(work);
		syncWorkFormFromDetail();
		await loadWorkVersions(work.id);
		notifyWorksUpdated();
	} catch (error) {
		workPublishError =
			error instanceof Error ? error.message : "Failed to publish version";
	} finally {
		workPublishSubmitting = false;
	}
}

async function onCopyWorkId(id: string) {
	try {
		await navigator.clipboard.writeText(id);
		workCopiedId = true;
		if (workCopiedIdTimer) clearTimeout(workCopiedIdTimer);
		workCopiedIdTimer = setTimeout(() => {
			workCopiedId = false;
		}, 1600);
	} catch (error) {
		workDetailError =
			error instanceof Error ? error.message : "Failed to copy work ID";
	}
}

async function onToggleWorkStatus(status: "published" | "disabled") {
	if (!workDetail || workActionInProgress) return;
	workActionInProgress = true;
	workDetailError = "";
	try {
		const { work } = await sdk.works.update(workDetail.id, { status });
		workDetail = work;
		onDetailLoaded?.(work);
		syncWorkFormFromDetail();
		void loadWorkVersions(work.id);
		notifyWorksUpdated();
	} catch (error) {
		workDetailError =
			error instanceof Error ? error.message : "Failed to update work";
		void loadWorkDetail(workDetail.id);
	} finally {
		workActionInProgress = false;
	}
}

async function onDeleteWork() {
	if (
		!workDetail ||
		workActionInProgress ||
		workDeleteInProgress ||
		!confirm(
			"Delete this work? This removes the management record and public link.",
		)
	)
		return;
	const deletedWorkId = workDetail.id;
	let deleted = false;
	workActionInProgress = true;
	workDeleteInProgress = true;
	workDetailError = "";
	try {
		await sdk.works.delete(deletedWorkId);
		deleted = true;
		workDetail = null;
		onDetailLoaded?.(null);
		notifyWorksUpdated();
		await goto(buildSpaceLandingRoute(spaceId), { replaceState: true });
	} catch (error) {
		workDetailError =
			error instanceof Error ? error.message : "Failed to delete work";
	} finally {
		if (!deleted) {
			workActionInProgress = false;
			workDeleteInProgress = false;
		}
	}
}

async function onUpdateWorkSubmit(event: SubmitEvent) {
	event.preventDefault();
	if (!workDetail || workFormSubmitting) return;
	workFormError = "";
	if (!workFormSlug.trim()) {
		workFormError = "Slug is required";
		return;
	}
	if (!workFormTargetRef.trim()) {
		workFormError = "Target is required";
		return;
	}
	workFormSubmitting = true;
	try {
		const { work } = await sdk.works.update(workDetail.id, {
			slug: workFormSlug.trim(),
			status: workFormStatus,
			targetType: workFormTargetType,
			targetRef: workFormTargetRef.trim(),
			workScopes: selectedScopeList(workFormScopes, WORK_SCOPE_OPTIONS),
			allowedViewerScopes: selectedScopeList(
				workFormViewerScopes,
				WORK_VIEWER_SCOPE_OPTIONS,
			),
		});
		workDetail = work;
		onDetailLoaded?.(work);
		workEditMode = false;
		syncWorkFormFromDetail();
		void loadWorkVersions(work.id);
		notifyWorksUpdated();
	} catch (error) {
		workFormError =
			error instanceof Error ? error.message : "Failed to save work";
	} finally {
		workFormSubmitting = false;
	}
}

function resetWorkTransientState() {
	workDetailLoading = false;
	workVersions = [];
	workVersionsLoading = false;
	workVersionsError = "";
	workEditMode = false;
	workActionInProgress = false;
	workDeleteInProgress = false;
	workFormError = "";
	workPublishError = "";
}

$effect(() => {
	const stateKey = `${spaceId}:${routeWorkId ?? ""}`;
	if (workRouteStateKey === stateKey) return;
	workRouteStateKey = stateKey;
	resetWorkTransientState();
	if (routeWorkId) {
		void loadWorkDetail(routeWorkId);
		return;
	}
	workDetail = null;
	onDetailLoaded?.(null);
});

onDestroy(() => {
	if (workCopiedIdTimer) clearTimeout(workCopiedIdTimer);
});
</script>

{#snippet CopyIdMetaItem(id: string, copied: boolean, onCopy: () => void, label = "Copy ID")}
	<button
		type="button"
		class="inline-flex min-h-6 min-w-0 max-w-full items-center gap-1.5 font-mono text-[11px] text-text-placeholder transition-colors hover:text-text-secondary"
		onclick={onCopy}
		title={label}
	>
		<span class="truncate">{id}</span>
		{#if copied}
			<Check class="h-3 w-3 shrink-0 text-success-soft" />
		{:else}
			<Copy class="h-3 w-3 shrink-0" />
		{/if}
	</button>
{/snippet}

<div class="flex-1 min-h-0 overflow-y-auto px-4 py-5 sm:px-6 lg:px-8">
  <div class="max-w-5xl">
  {#if workDetailLoading && workDetail?.id !== routeWorkId}
    <CenteredLoading label="Loading work…" size="panel" />
  {:else if workDetailError}
    <div class="rounded-md border border-error-soft/30 bg-error-bg p-3 text-[12px] font-mono text-error-soft break-all">{workDetailError}</div>
  {:else if workDetail && workDetail.id === routeWorkId}
    {@const publicRoute = workPublicRoute(workDetail)}
    <div class="space-y-6 sm:space-y-8">
      <header class="flex flex-col gap-4 border-b border-border-subtle/70 pb-5 lg:flex-row lg:items-start lg:justify-between">
        <div class="min-w-0 space-y-3">
          <div>
            <h1 class="font-mono text-[24px] font-semibold tracking-tight text-text-primary break-all sm:text-[30px]">{workDetail.slug}</h1>
            <div class="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <span class="inline-flex items-center gap-1.5 text-[11px] font-medium {workStatusTone(workDetail.status)}">
                <span class="h-1.5 w-1.5 rounded-full {workDetail.status === 'published' ? 'bg-status-running' : workDetail.status === 'disabled' ? 'bg-status-error' : 'bg-text-placeholder'}"></span>
                {workDetail.status}
              </span>
              {@render CopyIdMetaItem(workDetail.id, workCopiedId, () => void onCopyWorkId(workDetail!.id), 'Copy work ID')}
              <span class="font-mono text-[11px] text-text-placeholder">{workDetail.targetType}:{workDetail.targetRef}</span>
            </div>
          </div>
        </div>
        <div class="flex shrink-0 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          {#if publicRoute}
            <a href={publicRoute} target="_blank" rel="noopener" class="inline-flex min-h-9 w-full items-center justify-center gap-1.5 rounded-[5px] bg-brand-muted px-3 py-2 text-[12px] font-medium text-brand transition-colors hover:bg-brand-muted-hover sm:w-auto">
              <ExternalLink class="h-3.5 w-3.5" />
              <span>Open public page</span>
            </a>
          {/if}
          <button type="button" class="inline-flex min-h-9 w-full items-center justify-center gap-1.5 rounded-[5px] bg-bg-elevated px-3 py-2 text-[12px] font-medium text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary sm:w-auto" onclick={() => { syncWorkFormFromDetail(); workEditMode = !workEditMode; }}>
            <Pencil class="h-3.5 w-3.5" />
            <span>{workEditMode ? 'Close edit' : 'Edit'}</span>
          </button>
          <button type="button" class="inline-flex min-h-9 w-full items-center justify-center gap-1.5 rounded-[5px] bg-bg-elevated px-3 py-2 text-[12px] font-medium transition-colors hover:bg-bg-hover disabled:opacity-50 sm:w-auto {workDetail.status === 'published' ? 'text-status-running' : 'text-text-secondary'}" onclick={() => onToggleWorkStatus(workDetail!.status === 'published' ? 'disabled' : 'published')} disabled={workActionInProgress}>
            {#if workActionInProgress}<Loader2 class="h-3.5 w-3.5 animate-spin" />{:else if workDetail.status === 'published'}<Power class="h-3.5 w-3.5" />{:else}<PowerOff class="h-3.5 w-3.5" />{/if}
            <span>{workDetail.status === 'published' ? 'Disable' : 'Publish'}</span>
          </button>
          <button type="button" class="inline-flex min-h-9 w-full items-center justify-center gap-1.5 rounded-[5px] px-3 py-2 text-[12px] font-medium text-text-tertiary transition-colors hover:bg-bg-hover hover:text-error-soft disabled:opacity-50 sm:w-auto" onclick={onDeleteWork} disabled={workActionInProgress || workDeleteInProgress}>
            {#if workDeleteInProgress}<Loader2 class="h-3.5 w-3.5 animate-spin" />{:else}<Trash2 class="h-3.5 w-3.5" />{/if}
            <span>{workDeleteInProgress ? 'Deleting…' : 'Delete'}</span>
          </button>
        </div>
      </header>

      {#if workEditMode}
        <form onsubmit={onUpdateWorkSubmit} class="space-y-6">
          <section class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
            <div class="min-w-0 space-y-5">
              <div class="space-y-1.5">
                <label class="block text-[10px] font-medium uppercase tracking-wider text-text-tertiary" for="work-edit-slug">Slug</label>
                <input id="work-edit-slug" type="text" bind:value={workFormSlug} class="w-full rounded-[6px] border border-border-subtle bg-bg-input px-3 py-2 font-mono text-[13px] text-text-primary transition-colors focus:border-brand/50 focus:outline-none" />
              </div>
              <div class="grid gap-4 sm:grid-cols-[160px_minmax(0,1fr)]">
                <div class="space-y-1.5">
                  <label class="block text-[10px] font-medium uppercase tracking-wider text-text-tertiary" for="work-edit-target-type">Target</label>
                  <select id="work-edit-target-type" bind:value={workFormTargetType} class="w-full rounded-[6px] border border-border-subtle bg-bg-input px-3 py-2 text-[13px] text-text-primary transition-colors focus:border-brand/50 focus:outline-none">
                    <option value="file">File</option>
                    <option value="directory">Directory</option>
                    <option value="port">Port</option>
                  </select>
                </div>
                <div class="space-y-1.5">
                  <label class="block text-[10px] font-medium uppercase tracking-wider text-text-tertiary" for="work-edit-target-ref">Reference</label>
                  <input id="work-edit-target-ref" type="text" bind:value={workFormTargetRef} class="w-full rounded-[6px] border border-border-subtle bg-bg-input px-3 py-2 font-mono text-[13px] text-text-primary transition-colors focus:border-brand/50 focus:outline-none" />
                </div>
              </div>
              <div class="space-y-1.5">
                <label class="block text-[10px] font-medium uppercase tracking-wider text-text-tertiary" for="work-edit-status">Status</label>
                <select id="work-edit-status" bind:value={workFormStatus} class="w-full rounded-[6px] border border-border-subtle bg-bg-input px-3 py-2 text-[13px] text-text-primary transition-colors focus:border-brand/50 focus:outline-none sm:max-w-[220px]">
                  <option value="draft">Draft</option>
                  <option value="published">Published</option>
                  <option value="disabled">Disabled</option>
                </select>
              </div>
            </div>
            <aside class="space-y-5 text-[13px]">
              <div class="space-y-3">
                <div class="text-[10px] font-medium uppercase tracking-[0.18em] text-text-placeholder">Work can</div>
                {#each WORK_SCOPE_OPTIONS as option (option.scope)}
                  <label class="flex gap-3 rounded-[6px] bg-bg-elevated/30 px-3 py-2.5 text-text-secondary">
                    <input type="checkbox" bind:checked={workFormScopes[option.scope]} class="mt-0.5" />
                    <span class="min-w-0"><span class="block text-[12px] text-text-primary">{option.label}</span><span class="block text-[11px] leading-5 text-text-placeholder">{option.description}</span></span>
                  </label>
                {/each}
              </div>
              <div class="space-y-3">
                <div class="text-[10px] font-medium uppercase tracking-[0.18em] text-text-placeholder">Viewers can allow</div>
                {#each WORK_VIEWER_SCOPE_OPTIONS as option (option.scope)}
                  <label class="flex gap-3 rounded-[6px] bg-bg-elevated/30 px-3 py-2.5 text-text-secondary">
                    <input type="checkbox" bind:checked={workFormViewerScopes[option.scope]} class="mt-0.5" />
                    <span class="min-w-0"><span class="block text-[12px] text-text-primary">{option.label}</span><span class="block text-[11px] leading-5 text-text-placeholder">{option.description}</span></span>
                  </label>
                {/each}
              </div>
            </aside>
          </section>
          {#if workFormError}
            <div class="rounded-md border border-error-soft/30 bg-error-bg p-3 text-[12px] font-mono text-error-soft break-all">{workFormError}</div>
          {/if}
          <div class="flex flex-col-reverse gap-2 border-t border-border-subtle/70 pt-4 sm:flex-row sm:justify-end">
            <button type="button" class="inline-flex min-h-10 items-center justify-center rounded-[5px] border border-border-subtle px-3 py-2 text-[12px] text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary" onclick={() => { workEditMode = false; syncWorkFormFromDetail(); }}>Cancel</button>
            <button type="submit" class="inline-flex min-h-10 items-center justify-center gap-2 rounded-[5px] bg-brand px-3 py-2 text-[12px] font-medium text-brand-contrast-fg transition-colors hover:bg-brand-hover disabled:opacity-50" disabled={workFormSubmitting}>
              {#if workFormSubmitting}<Loader2 class="h-3.5 w-3.5 animate-spin" />{:else}<Check class="h-3.5 w-3.5" />{/if}
              <span>Save changes</span>
            </button>
          </div>
        </form>
      {:else}
        <section class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px] lg:gap-8">
          <div class="min-w-0 space-y-6">
            <section class="space-y-3">
              <div class="text-[10px] font-medium uppercase tracking-[0.18em] text-text-placeholder">Target</div>
              <div class="relative overflow-hidden rounded-[8px] bg-bg-elevated/40 ring-1 ring-border-subtle/60">
                <div class="absolute left-0 top-0 h-full w-[3px] bg-brand"></div>
                <div class="px-5 py-4 pl-6">
                  <div class="font-mono text-[13px] text-text-primary break-all">{workDetail.targetRef}</div>
                  <div class="mt-2 text-[12px] text-text-tertiary">{workDetail.targetType} · asset {workDetail.assetKey ? 'ready' : 'not stored'}</div>
                </div>
              </div>
            </section>
            <section class="space-y-3 border-y border-border-subtle/70 py-4">
              <div class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <div class="flex min-w-0 items-baseline gap-2">
                  <div class="text-[10px] font-medium uppercase tracking-[0.18em] text-text-placeholder">Publish version</div>
                  <div class="hidden text-[12px] text-text-tertiary sm:block">Move the public link to a fresh snapshot.</div>
                </div>
                <div class="font-mono text-[11px] text-text-placeholder">Current v{workDetail.latestVersion || 0}</div>
              </div>
              <div class="grid gap-2 sm:grid-cols-[128px_minmax(0,1fr)_112px] sm:items-center">
                <label class="sr-only" for="work-publish-target-type">Target type</label>
                <select id="work-publish-target-type" bind:value={workPublishTargetType} class="min-h-10 w-full rounded-[6px] border border-border-subtle bg-bg-input px-3 text-[13px] text-text-primary transition-colors hover:border-border-default focus:border-brand/50 focus:outline-none">
                  <option value="file">File</option>
                  <option value="directory">Directory</option>
                  <option value="port">Port</option>
                </select>
                <label class="sr-only" for="work-publish-target-ref">Target reference</label>
                <input id="work-publish-target-ref" type="text" bind:value={workPublishTargetRef} placeholder="Target reference" class="min-h-10 w-full rounded-[6px] border border-border-subtle bg-bg-input px-3 font-mono text-[13px] text-text-primary transition-colors placeholder:text-text-placeholder hover:border-border-default focus:border-brand/50 focus:outline-none" />
                <button type="button" class="inline-flex min-h-10 items-center justify-center gap-2 rounded-[5px] bg-brand px-3 text-[12px] font-medium text-brand-contrast-fg transition-opacity hover:opacity-90 disabled:opacity-50" onclick={() => void onPublishWorkVersion()} disabled={workPublishSubmitting}>
                  {#if workPublishSubmitting}<Loader2 class="h-3.5 w-3.5 animate-spin" />{:else}<Rocket class="h-3.5 w-3.5" />{/if}
                  <span>Publish</span>
                </button>
              </div>
              {#if workPublishError}
                <div class="rounded-[6px] border border-error-soft/30 bg-error-bg px-3 py-2 text-[12px] font-mono text-error-soft break-all">{workPublishError}</div>
              {/if}
            </section>
            <section class="grid gap-3 sm:grid-cols-2">
              <div class="rounded-[7px] bg-bg-elevated/30 px-3 py-2.5">
                <div class="text-[10px] font-medium uppercase tracking-wider text-text-placeholder">Work permissions</div>
                <div class="mt-1 text-[13px] text-text-primary">{workDetail.workScopes.length ? workDetail.workScopes.join(', ') : 'None'}</div>
              </div>
              <div class="rounded-[7px] bg-bg-elevated/30 px-3 py-2.5">
                <div class="text-[10px] font-medium uppercase tracking-wider text-text-placeholder">Viewer grants</div>
                <div class="mt-1 text-[13px] text-text-primary">{workDetail.allowedViewerScopes.length ? workDetail.allowedViewerScopes.join(', ') : 'None'}</div>
              </div>
            </section>
          </div>
          <aside class="space-y-5 text-[13px]">
            <div class="space-y-2.5">
              <div class="flex items-center justify-between gap-3">
                <div class="text-[10px] font-medium uppercase tracking-[0.18em] text-text-placeholder">Versions</div>
                {#if workVersionsLoading}<Loader2 class="h-3.5 w-3.5 animate-spin text-text-placeholder" />{/if}
              </div>
              {#if workVersionsError}
                <div class="border-y border-error-soft/30 py-3 text-[12px] text-error-soft">{workVersionsError}</div>
              {:else if workVersions.length}
                <div class="divide-y divide-border-subtle/70 border-y border-border-subtle/70">
                  {#each workVersions.slice(0, 6) as version (version.id)}
                    <div class="py-2.5">
                      <div class="flex items-center justify-between gap-2">
                        <div class="flex min-w-0 items-center gap-2">
                          <span class="font-mono text-[12px] text-text-primary">v{version.version}</span>
                          <span class="truncate font-mono text-[11px] text-text-tertiary">{version.targetType}:{version.targetRef}</span>
                        </div>
                        {#if version.id === workDetail.currentVersionId}<span class="shrink-0 rounded-full bg-brand-muted px-2 py-0.5 text-[10px] font-medium text-brand">Current</span>{/if}
                      </div>
                      <div class="mt-1 text-[11px] text-text-placeholder">{formatDateTime(version.publishedAt)}</div>
                    </div>
                  {/each}
                </div>
              {:else}
                <div class="border-y border-border-subtle/70 py-3 text-[12px] text-text-tertiary">First publish creates v1.</div>
              {/if}
            </div>
            <div class="space-y-3">
              <div class="text-[10px] font-medium uppercase tracking-[0.18em] text-text-placeholder">Metadata</div>
              <div class="grid grid-cols-[76px_minmax(0,1fr)] gap-x-3 gap-y-2 text-[12px]">
                <div class="text-text-placeholder">Created</div><div class="text-text-secondary">{formatDateTime(workDetail.createdAt)}</div>
                <div class="text-text-placeholder">Updated</div><div class="text-text-secondary">{formatDateTime(workDetail.updatedAt)}</div>
                <div class="text-text-placeholder">Published</div><div class="text-text-secondary">{formatDateTime(workDetail.publishedAt)}</div>
                <div class="text-text-placeholder">Owner</div><div class="font-mono text-text-secondary break-all">{workDetail.userUuid}</div>
              </div>
            </div>
            {#if publicRoute}
              <div class="space-y-1.5">
                <div class="text-[10px] font-medium uppercase tracking-wider text-text-placeholder">Public path</div>
                <div class="font-mono text-[12px] text-text-secondary break-all">{publicRoute}</div>
              </div>
            {/if}
          </aside>
        </section>
      {/if}
    </div>
  {:else}
    <div class="text-[12px] text-text-tertiary">Work not found.</div>
  {/if}
  </div>
</div>
