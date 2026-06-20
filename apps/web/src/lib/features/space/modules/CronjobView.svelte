<script lang="ts">
import type {
	CronJobRecord,
	TaskRunRecord,
	UserProfile,
} from "@neta-art/cohub";
import {
	Check,
	Clock,
	Clock3,
	Copy,
	Loader2,
	Pencil,
	Plus,
	Power,
	PowerOff,
	Settings,
	Trash2,
} from "lucide-svelte";
import { goto } from "$app/navigation";
import CenteredLoading from "$lib/components/CenteredLoading.svelte";
import ModelSelector from "$lib/components/ModelSelector.svelte";
import UserAvatar from "$lib/components/UserAvatar.svelte";
import { sdk } from "$lib/sdk";
import {
	buildSpaceCronjobRoute,
	buildSpaceNewSessionRoute,
	buildSpaceTaskRoute,
} from "$lib/space-routes";
import { modelsCatalogStore } from "$lib/stores/models-catalog.svelte";
import { mergeCachedCronJobTaskRuns } from "$lib/stores/task-runs-cache";
import {
	displayUserName,
	formatDateTime,
	formatShortDateTime,
} from "../space-utils";
import {
	buildSendMessagePayload,
	cronjobModelLabel,
	cronjobPromptMeta,
	defaultTimezone,
	formatCronjobPrompt,
	promptTextFromPayload,
	validateCronjobForm,
} from "./cronjob-utils";
import {
	displaySafeJson,
	taskRunDuration,
	taskRunStatusBadge,
} from "./task-run-utils";

type SelectedModel = { provider: string; id: string; name?: string };

type Props = {
	mode: "create" | "detail";
	spaceId: string;
	spaceName: string;
	spaceLoadError: string;
	spaceHasMinimalAccess: boolean;
	cronjobId: string | null;
	onDetailLoaded?: (job: CronJobRecord | null) => void;
};

let {
	mode,
	spaceId,
	spaceName,
	spaceLoadError,
	spaceHasMinimalAccess,
	cronjobId,
	onDetailLoaded,
}: Props = $props();

const modelsCatalog = $derived(modelsCatalogStore.items);
const visibleModelsCatalog = $derived(modelsCatalogStore.visibleItems);
const firstCatalogModel = $derived.by(() => {
	const item = visibleModelsCatalog?.[0];
	return item
		? {
				provider: item.provider,
				id: item.id,
				name: item.model.name as string | undefined,
			}
		: null;
});

let cronjobDetail = $state<CronJobRecord | null>(null);
let cronjobDetailLoading = $state(false);
let cronjobDetailError = $state("");
let cronjobRuns = $state<TaskRunRecord[]>([]);
let cronjobRunsLoading = $state(false);
let cronjobRunsLoadingMore = $state(false);
let cronjobRunsLoaded = $state(false);
let cronjobRunsHasMore = $state(false);
let cronjobRunsNextCursor = $state<string | null>(null);
let cronjobRunsError = $state("");
let cronjobActionInProgress = $state(false);
let cronjobDeleteInProgress = $state(false);
let cronjobToggleError = $state("");
let cronjobEditMode = $state(false);
let cronjobFormTitle = $state("");
let cronjobFormExpression = $state("");
let cronjobFormTimezone = $state("");
let cronjobFormPrompt = $state("");
let cronjobFormModel = $state<SelectedModel | null>(null);
let cronjobFormStructuredPrompt = $state(false);
let cronjobFormSubmitting = $state(false);
let cronjobFormError = $state("");
let cronjobCopiedId = $state(false);
let cronjobCopiedIdTimer: ReturnType<typeof setTimeout> | null = null;
let cronjobModelSelectorOpen = $state(false);
let cronjobModelSelectorTarget = $state<"new" | "edit">("new");
let cronjobNewTitle = $state("");
let cronjobNewExpression = $state("");
let cronjobNewTimezone = $state(defaultTimezone());
let cronjobNewPrompt = $state("");
let cronjobNewModel = $state<SelectedModel | null>(null);
let cronjobNewSubmitting = $state(false);
let cronjobNewError = $state("");

const taskRunSortTime = (run: Pick<TaskRunRecord, "updatedAt" | "createdAt">) =>
	Date.parse(run.updatedAt ?? run.createdAt ?? "") || 0;

function userTitle(
	profile: UserProfile | null | undefined,
	userUuid: string | null | undefined,
) {
	return [displayUserName(profile, userUuid), userUuid]
		.filter(Boolean)
		.join(" · ");
}

function payloadModelLabel(payload: unknown) {
	if (!payload || typeof payload !== "object") return "Default model";
	const model = (payload as { model?: unknown }).model;
	return typeof model === "string" && model.trim() ? model : "Default model";
}

function payloadProviderLabel(payload: unknown) {
	if (!payload || typeof payload !== "object") return "default";
	const provider = (payload as { provider?: unknown }).provider;
	return typeof provider === "string" && provider.trim() ? provider : "default";
}

function modelFromPayload(payload: unknown): SelectedModel | null {
	if (!payload || typeof payload !== "object") return null;
	const record = payload as { provider?: unknown; model?: unknown };
	if (typeof record.provider !== "string" || typeof record.model !== "string")
		return null;
	const catalogItem = modelsCatalog?.find(
		(item) => item.provider === record.provider && item.id === record.model,
	);
	return {
		provider: record.provider,
		id: record.model,
		name: catalogItem?.model.name as string | undefined,
	};
}

function syncCronjobFormFromDetail() {
	if (!cronjobDetail) return;
	const prompt = promptTextFromPayload(cronjobDetail.payload);
	cronjobFormTitle = cronjobDetail.title;
	cronjobFormExpression = cronjobDetail.cronExpression;
	cronjobFormTimezone = cronjobDetail.timezone || defaultTimezone();
	cronjobFormPrompt = prompt.text;
	cronjobFormStructuredPrompt = prompt.structured;
	cronjobFormModel = modelFromPayload(cronjobDetail.payload);
	cronjobFormError = "";
}

function notifyCronjobsUpdated() {
	if (typeof window === "undefined") return;
	window.dispatchEvent(
		new CustomEvent("cohub:cronjobs-updated", { detail: { spaceId } }),
	);
}

async function loadModelsCatalog() {
	try {
		await modelsCatalogStore.load();
	} catch (error) {
		console.error("Failed to load models catalog:", error);
	}
}

function openCronjobModelSelector(target: "new" | "edit") {
	cronjobModelSelectorTarget = target;
	cronjobModelSelectorOpen = true;
	void loadModelsCatalog();
	if (target === "new" && !cronjobNewModel && firstCatalogModel)
		cronjobNewModel = firstCatalogModel;
}

function handleCronjobModelSelect(model: { provider: string; id: string }) {
	const catalogItem = modelsCatalog?.find(
		(item) => item.provider === model.provider && item.id === model.id,
	);
	const selected = {
		provider: model.provider,
		id: model.id,
		name: catalogItem?.model.name as string | undefined,
	} satisfies SelectedModel;
	if (cronjobModelSelectorTarget === "new") cronjobNewModel = selected;
	else cronjobFormModel = selected;
	cronjobModelSelectorOpen = false;
}

async function loadCronjobDetail(targetCronjobId: string) {
	const requestSpaceId = spaceId;
	const isCurrentRequest = () =>
		spaceId === requestSpaceId &&
		mode === "detail" &&
		cronjobId === targetCronjobId;
	cronjobDetailLoading = true;
	cronjobDetailError = "";
	cronjobToggleError = "";
	try {
		const { job } = await sdk.cronJobs.get(targetCronjobId);
		if (!isCurrentRequest()) return;
		cronjobDetail = job;
		onDetailLoaded?.(job);
		syncCronjobFormFromDetail();
	} catch (error) {
		if (!isCurrentRequest()) return;
		cronjobDetail = null;
		onDetailLoaded?.(null);
		cronjobDetailError =
			error instanceof Error
				? error.message
				: "Failed to load scheduled prompt";
	} finally {
		if (isCurrentRequest()) cronjobDetailLoading = false;
	}
}

async function loadCronjobRuns(options: { reset?: boolean } = {}) {
	if (!cronjobDetail || !cronjobId) return;
	if (cronjobRunsLoading || cronjobRunsLoadingMore) return;
	const requestCronjobId = cronjobDetail.id;
	const reset = options.reset ?? !cronjobRunsLoaded;
	const cursor = reset ? null : cronjobRunsNextCursor;
	if (!reset && !cronjobRunsHasMore) return;
	if (reset) cronjobRunsLoading = true;
	else cronjobRunsLoadingMore = true;
	cronjobRunsError = "";
	try {
		const { runs, pageInfo } = await sdk.cronJobs.runs(requestCronjobId, {
			limit: 20,
			cursor,
		});
		if (mode !== "detail" || cronjobId !== requestCronjobId) return;
		cronjobRuns = reset
			? runs
			: [
					...cronjobRuns,
					...runs.filter(
						(run) => !cronjobRuns.some((item) => item.id === run.id),
					),
				];
		cronjobRuns = [...cronjobRuns].sort(
			(a, b) => taskRunSortTime(b) - taskRunSortTime(a),
		);
		cronjobRunsHasMore = pageInfo.hasMore;
		cronjobRunsNextCursor = pageInfo.nextCursor;
		cronjobRunsLoaded = true;
		mergeCachedCronJobTaskRuns(spaceId, requestCronjobId, runs);
	} catch (error) {
		cronjobRunsError =
			error instanceof Error ? error.message : "Failed to load runs";
	} finally {
		cronjobRunsLoading = false;
		cronjobRunsLoadingMore = false;
	}
}

async function handleToggleCronjob(enabled: boolean) {
	if (!cronjobDetail || cronjobActionInProgress) return;
	cronjobActionInProgress = true;
	try {
		const { job } = await sdk.cronJobs.toggle(cronjobDetail.id, enabled);
		cronjobDetail = job;
		onDetailLoaded?.(job);
		notifyCronjobsUpdated();
		syncCronjobFormFromDetail();
	} catch (error) {
		cronjobToggleError =
			error instanceof Error ? error.message : "Failed to toggle";
		void loadCronjobDetail(cronjobDetail.id);
	} finally {
		cronjobActionInProgress = false;
	}
}

async function handleDeleteCronjob() {
	if (
		!cronjobDetail ||
		cronjobActionInProgress ||
		cronjobDeleteInProgress ||
		!confirm("Are you sure you want to delete this scheduled prompt?")
	)
		return;
	const deletedCronjobId = cronjobDetail.id;
	cronjobActionInProgress = true;
	cronjobDeleteInProgress = true;
	cronjobDetailError = "";
	cronjobToggleError = "";
	try {
		await sdk.cronJobs.delete(deletedCronjobId);
		cronjobDetail = null;
		onDetailLoaded?.(null);
		cronjobRuns = [];
		notifyCronjobsUpdated();
		await goto(buildSpaceNewSessionRoute(spaceId), { replaceState: true });
	} catch (error) {
		cronjobDetailError =
			error instanceof Error ? error.message : "Failed to delete";
		cronjobActionInProgress = false;
		cronjobDeleteInProgress = false;
	}
}

async function handleUpdateCronjobSubmit(event: SubmitEvent) {
	event.preventDefault();
	if (!cronjobDetail || cronjobFormSubmitting) return;
	const error = validateCronjobForm({
		title: cronjobFormTitle,
		cronExpression: cronjobFormExpression,
		timezone: cronjobFormTimezone,
		prompt: cronjobFormPrompt,
	});
	if (error) {
		cronjobFormError = error;
		return;
	}
	cronjobFormSubmitting = true;
	cronjobFormError = "";
	try {
		const { job } = await sdk.cronJobs.update(cronjobDetail.id, {
			title: cronjobFormTitle.trim(),
			cronExpression: cronjobFormExpression.trim(),
			timezone: cronjobFormTimezone.trim(),
			payload: buildSendMessagePayload(
				cronjobDetail.payload,
				cronjobFormPrompt,
				cronjobFormModel,
			),
		});
		cronjobDetail = job;
		onDetailLoaded?.(job);
		cronjobEditMode = false;
		syncCronjobFormFromDetail();
		notifyCronjobsUpdated();
	} catch (error) {
		cronjobFormError =
			error instanceof Error ? error.message : "Failed to save";
	} finally {
		cronjobFormSubmitting = false;
	}
}

async function handleCreateCronjobSubmit(event: SubmitEvent) {
	event.preventDefault();
	if (cronjobNewSubmitting) return;
	const error = validateCronjobForm({
		title: cronjobNewTitle,
		cronExpression: cronjobNewExpression,
		timezone: cronjobNewTimezone,
		prompt: cronjobNewPrompt,
	});
	if (error) {
		cronjobNewError = error;
		return;
	}
	cronjobNewSubmitting = true;
	cronjobNewError = "";
	try {
		const response = await sdk.space(spaceId).prompt({
			title: cronjobNewTitle.trim(),
			content: [{ type: "text", text: cronjobNewPrompt.trim() }],
			provider: cronjobNewModel?.provider ?? null,
			model: cronjobNewModel?.id ?? null,
			schedule: {
				mode: "repeat",
				cronExpression: cronjobNewExpression.trim(),
				timezone: cronjobNewTimezone.trim(),
			},
		});
		if (response.mode !== "repeat")
			throw new Error("Failed to create scheduled prompt");
		notifyCronjobsUpdated();
		await goto(buildSpaceCronjobRoute(spaceId, response.cronJobId));
	} catch (error) {
		cronjobNewError =
			error instanceof Error
				? error.message
				: "Failed to create scheduled prompt";
	} finally {
		cronjobNewSubmitting = false;
	}
}

async function copyCronjobId(id: string) {
	await navigator.clipboard.writeText(id);
	cronjobCopiedId = true;
	if (cronjobCopiedIdTimer) clearTimeout(cronjobCopiedIdTimer);
	cronjobCopiedIdTimer = setTimeout(() => {
		cronjobCopiedId = false;
	}, 1600);
}

$effect(() => {
	if (mode === "detail" && cronjobId) {
		void loadCronjobDetail(cronjobId);
		return;
	}
	cronjobDetail = null;
	onDetailLoaded?.(null);
	cronjobRuns = [];
	cronjobRunsLoaded = false;
});
</script>

{#snippet UserMetaItem(profile: UserProfile | null | undefined, userUuid: string | null | undefined)}
	{#if userUuid}
		<span class="inline-flex min-w-0 max-w-full items-center gap-1.5 text-[11px] text-text-tertiary" title={userTitle(profile, userUuid)}>
			<UserAvatar name={displayUserName(profile, userUuid)} avatarUrl={profile?.avatarUrl} size="xxs" class="border-0 bg-bg-elevated" />
			<span class="min-w-0 truncate">{displayUserName(profile, userUuid)}</span>
		</span>
	{/if}
{/snippet}

{#if mode === "create"}
	<div class="flex-1 min-h-0 overflow-y-auto px-4 py-5 sm:px-6 lg:px-8">
		<div class="max-w-3xl">
			{#if spaceLoadError && !spaceHasMinimalAccess}
				<div class="rounded-md border border-error-soft/30 bg-error-bg p-3 text-[12px] font-mono text-error-soft break-all">{spaceLoadError}</div>
			{:else}
				<form onsubmit={handleCreateCronjobSubmit} class="space-y-6">
					<header class="border-b border-border-subtle/70 pb-5">
						<div class="text-[10px] font-medium uppercase tracking-[0.18em] text-text-placeholder">Scheduled prompt</div>
						<h1 class="mt-2 text-[24px] font-semibold tracking-tight text-text-primary sm:text-[30px]">New scheduled prompt</h1>
						<p class="mt-2 max-w-2xl text-[13px] leading-6 text-text-tertiary">Send a prompt to <span class="font-medium text-text-primary">{spaceName}</span> on a recurring schedule.</p>
					</header>
					<section class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_240px]">
						<div class="min-w-0 space-y-5">
							<div class="space-y-1.5">
								<label class="block text-[10px] font-medium uppercase tracking-wider text-text-tertiary" for="cronjob-title">Title</label>
								<input id="cronjob-title" type="text" bind:value={cronjobNewTitle} placeholder="Daily report" class="w-full rounded-[6px] border border-border-subtle bg-bg-input px-3 py-2 text-[13px] text-text-primary placeholder:text-text-placeholder transition-colors focus:border-brand/50 focus:outline-none" />
							</div>
							<div class="space-y-1.5">
								<label class="block text-[10px] font-medium uppercase tracking-wider text-text-tertiary" for="cronjob-prompt">Prompt</label>
								<textarea id="cronjob-prompt" bind:value={cronjobNewPrompt} rows="8" placeholder="Message content to send on every run…" class="w-full resize-y rounded-[6px] border border-border-subtle bg-bg-input px-3 py-2 text-[13px] leading-6 text-text-primary placeholder:text-text-placeholder transition-colors focus:border-brand/50 focus:outline-none"></textarea>
							</div>
						</div>
						<aside class="space-y-5 text-[13px]">
							<div class="space-y-1.5">
								<label class="block text-[10px] font-medium uppercase tracking-wider text-text-placeholder" for="cronjob-expression">Schedule</label>
								<input id="cronjob-expression" type="text" bind:value={cronjobNewExpression} placeholder="0 9 * * *" class="w-full rounded-[6px] border border-border-subtle bg-bg-input px-3 py-2 font-mono text-[13px] text-text-primary placeholder:text-text-placeholder transition-colors focus:border-brand/50 focus:outline-none" />
								<p class="text-[11px] leading-5 text-text-placeholder">5 fields · minute hour day month weekday</p>
							</div>
							<div class="space-y-1.5">
								<label class="block text-[10px] font-medium uppercase tracking-wider text-text-placeholder" for="cronjob-timezone">Timezone</label>
								<input id="cronjob-timezone" type="text" bind:value={cronjobNewTimezone} placeholder="UTC" class="w-full rounded-[6px] border border-border-subtle bg-bg-input px-3 py-2 text-[13px] text-text-primary placeholder:text-text-placeholder transition-colors focus:border-brand/50 focus:outline-none" />
							</div>
							<div class="space-y-2">
								<div class="text-[10px] font-medium uppercase tracking-wider text-text-placeholder">Model</div>
								<button type="button" class="flex min-h-10 w-full items-center justify-between gap-3 rounded-[6px] border border-border-subtle bg-bg-elevated/35 px-3 py-2 text-left transition-colors hover:bg-bg-hover" onclick={() => openCronjobModelSelector("new") }>
									<span class="min-w-0 truncate text-[13px] text-text-primary">{cronjobModelLabel(cronjobNewModel)}</span>
									<Settings class="h-3.5 w-3.5 shrink-0 text-text-placeholder" />
								</button>
								{#if cronjobNewModel}
									<button type="button" class="text-[11px] text-text-placeholder transition-colors hover:text-text-secondary" onclick={() => { cronjobNewModel = null; }}>Use default model</button>
								{/if}
							</div>
						</aside>
					</section>
					{#if cronjobNewError}
						<div class="rounded-md border border-error-soft/30 bg-error-bg p-3 text-[12px] font-mono text-error-soft break-all">{cronjobNewError}</div>
					{/if}
					<div class="flex flex-col-reverse gap-2 border-t border-border-subtle/70 pt-4 sm:flex-row sm:justify-end">
						<button type="button" class="inline-flex min-h-10 items-center justify-center rounded-[5px] border border-border-subtle px-3 py-2 text-[12px] text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary" onclick={() => goto(buildSpaceNewSessionRoute(spaceId))}>Cancel</button>
						<button type="submit" class="inline-flex min-h-10 items-center justify-center gap-2 rounded-[5px] bg-brand px-3 py-2 text-[12px] font-medium text-brand-contrast-fg transition-colors hover:bg-brand-hover disabled:opacity-50" disabled={cronjobNewSubmitting}>
							{#if cronjobNewSubmitting}<Loader2 class="h-3.5 w-3.5 animate-spin" />{:else}<Plus class="h-3.5 w-3.5" />{/if}
							<span>Create scheduled prompt</span>
						</button>
					</div>
				</form>
			{/if}
		</div>
	</div>
{:else}
	<div class="flex-1 min-h-0 overflow-y-auto px-4 py-5 sm:px-6 lg:px-8">
		<div class="max-w-5xl">
			{#if cronjobDetailLoading && cronjobDetail?.id !== cronjobId}
				<CenteredLoading label="Loading cronjob…" size="panel" />
			{:else if cronjobDetailError}
				<div class="rounded-md border border-error-soft/30 bg-error-bg p-3 text-[12px] font-mono text-error-soft break-all">{cronjobDetailError}</div>
			{:else if cronjobDetail && cronjobDetail.id === cronjobId}
				{@const activeModel = null}
				<div class="space-y-6 sm:space-y-8">
					<header class="flex flex-col gap-4 border-b border-border-subtle/70 pb-5 lg:flex-row lg:items-start lg:justify-between">
						<div class="min-w-0 space-y-3">
							<div>
								<h1 class="text-[24px] font-semibold tracking-tight text-text-primary break-words sm:text-[30px]">{cronjobDetail.title}</h1>
								<div class="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5">
									<span class="inline-flex items-center gap-1.5 text-[11px] font-medium text-brand">
										<span class="h-1.5 w-1.5 rounded-full {cronjobDetail.enabled ? 'bg-status-running' : 'bg-text-placeholder'}"></span>
										{cronjobDetail.enabled ? 'Active' : 'Paused'}
									</span>
									{@render UserMetaItem(cronjobDetail.userProfile, cronjobDetail.userUuid)}
									<button type="button" class="inline-flex min-h-6 min-w-0 max-w-full items-center gap-1.5 font-mono text-[11px] text-text-placeholder transition-colors hover:text-text-secondary" onclick={() => void copyCronjobId(cronjobDetail!.id)} title="Copy cronjob ID">
										<span class="truncate">{cronjobDetail.id}</span>
										{#if cronjobCopiedId}<Check class="h-3 w-3 shrink-0 text-success-soft" />{:else}<Copy class="h-3 w-3 shrink-0" />{/if}
									</button>
								</div>
							</div>
						</div>
						<div class="flex shrink-0 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
							{#if cronjobDetail.taskType === 'send_message'}
								<button type="button" class="inline-flex min-h-9 w-full items-center justify-center gap-1.5 rounded-[5px] bg-bg-elevated px-3 py-2 text-[12px] font-medium text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary sm:w-auto" onclick={() => { syncCronjobFormFromDetail(); cronjobEditMode = !cronjobEditMode; }}>
									<Pencil class="h-3.5 w-3.5" />
									<span>{cronjobEditMode ? 'Close edit' : 'Edit'}</span>
								</button>
							{/if}
							<button type="button" class="inline-flex min-h-9 w-full items-center justify-center gap-1.5 rounded-[5px] bg-bg-elevated px-3 py-2 text-[12px] font-medium transition-colors hover:bg-bg-hover disabled:opacity-50 sm:w-auto {cronjobDetail.enabled ? 'text-status-running' : 'text-text-secondary'}" onclick={() => handleToggleCronjob(!cronjobDetail!.enabled)} disabled={cronjobActionInProgress}>
								{#if cronjobActionInProgress}<Loader2 class="h-3.5 w-3.5 animate-spin" />{:else if cronjobDetail.enabled}<Power class="h-3.5 w-3.5" />{:else}<PowerOff class="h-3.5 w-3.5" />{/if}
								<span>{cronjobDetail.enabled ? 'Pause' : 'Resume'}</span>
							</button>
							<button type="button" class="inline-flex min-h-9 w-full items-center justify-center gap-1.5 rounded-[5px] px-3 py-2 text-[12px] font-medium text-text-tertiary transition-colors hover:bg-bg-hover hover:text-error-soft disabled:opacity-50 sm:w-auto" onclick={handleDeleteCronjob} disabled={cronjobActionInProgress || cronjobDeleteInProgress}>
								{#if cronjobDeleteInProgress}<Loader2 class="h-3.5 w-3.5 animate-spin" />{:else}<Trash2 class="h-3.5 w-3.5" />{/if}
								<span>{cronjobDeleteInProgress ? 'Deleting…' : 'Delete'}</span>
							</button>
						</div>
					</header>
					{#if cronjobToggleError}
						<div class="rounded-[6px] border border-error-soft/30 bg-error-bg p-3 text-[12px] font-mono text-error-soft">{cronjobToggleError}</div>
					{/if}
					{#if cronjobEditMode && cronjobDetail.taskType === 'send_message'}
						<form onsubmit={handleUpdateCronjobSubmit} class="space-y-6">
							<section class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_260px]">
								<div class="min-w-0 space-y-5">
									<div class="space-y-1.5"><label class="block text-[10px] font-medium uppercase tracking-wider text-text-tertiary" for="cronjob-edit-title">Title</label><input id="cronjob-edit-title" type="text" bind:value={cronjobFormTitle} class="w-full rounded-[6px] border border-border-subtle bg-bg-input px-3 py-2 text-[13px] text-text-primary transition-colors focus:border-brand/50 focus:outline-none" /></div>
									<div class="space-y-1.5"><label class="block text-[10px] font-medium uppercase tracking-wider text-text-tertiary" for="cronjob-edit-prompt">Prompt</label>{#if cronjobFormStructuredPrompt}<div class="rounded-[6px] border border-border-subtle bg-bg-elevated/35 p-3 text-[12px] leading-5 text-text-tertiary">This prompt contains structured content. Saving will replace it with plain text.</div>{/if}<textarea id="cronjob-edit-prompt" bind:value={cronjobFormPrompt} rows="9" class="w-full resize-y rounded-[6px] border border-border-subtle bg-bg-input px-3 py-2 text-[13px] leading-6 text-text-primary transition-colors focus:border-brand/50 focus:outline-none"></textarea></div>
								</div>
								<aside class="space-y-5 text-[13px]">
									<div class="space-y-1.5"><label class="block text-[10px] font-medium uppercase tracking-wider text-text-placeholder" for="cronjob-edit-expression">Schedule</label><input id="cronjob-edit-expression" type="text" bind:value={cronjobFormExpression} class="w-full rounded-[6px] border border-border-subtle bg-bg-input px-3 py-2 font-mono text-[13px] text-text-primary transition-colors focus:border-brand/50 focus:outline-none" /></div>
									<div class="space-y-1.5"><label class="block text-[10px] font-medium uppercase tracking-wider text-text-placeholder" for="cronjob-edit-timezone">Timezone</label><input id="cronjob-edit-timezone" type="text" bind:value={cronjobFormTimezone} class="w-full rounded-[6px] border border-border-subtle bg-bg-input px-3 py-2 text-[13px] text-text-primary transition-colors focus:border-brand/50 focus:outline-none" /></div>
									<div class="space-y-2"><div class="text-[10px] font-medium uppercase tracking-wider text-text-placeholder">Model</div><button type="button" class="flex min-h-10 w-full items-center justify-between gap-3 rounded-[6px] border border-border-subtle bg-bg-elevated/35 px-3 py-2 text-left transition-colors hover:bg-bg-hover" onclick={() => openCronjobModelSelector('edit')}><span class="min-w-0 truncate text-[13px] text-text-primary">{cronjobModelLabel(cronjobFormModel)}</span><Settings class="h-3.5 w-3.5 shrink-0 text-text-placeholder" /></button>{#if cronjobFormModel}<button type="button" class="text-[11px] text-text-placeholder transition-colors hover:text-text-secondary" onclick={() => { cronjobFormModel = null; }}>Use default model</button>{/if}</div>
								</aside>
							</section>
							{#if cronjobFormError}<div class="rounded-md border border-error-soft/30 bg-error-bg p-3 text-[12px] font-mono text-error-soft break-all">{cronjobFormError}</div>{/if}
							<div class="flex flex-col-reverse gap-2 border-t border-border-subtle/70 pt-4 sm:flex-row sm:justify-end"><button type="button" class="inline-flex min-h-10 items-center justify-center rounded-[5px] border border-border-subtle px-3 py-2 text-[12px] text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary" onclick={() => { cronjobEditMode = false; syncCronjobFormFromDetail(); }}>Cancel</button><button type="submit" class="inline-flex min-h-10 items-center justify-center gap-2 rounded-[5px] bg-brand px-3 py-2 text-[12px] font-medium text-brand-contrast-fg transition-colors hover:bg-brand-hover disabled:opacity-50" disabled={cronjobFormSubmitting}>{#if cronjobFormSubmitting}<Loader2 class="h-3.5 w-3.5 animate-spin" />{:else}<Check class="h-3.5 w-3.5" />{/if}<span>Save changes</span></button></div>
						</form>
					{:else}
						<section class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_260px] lg:gap-8">
							<div class="min-w-0 space-y-6">
								{#if cronjobDetail.taskType === 'send_message'}
									<section class="space-y-3"><div><div class="text-[10px] font-medium uppercase tracking-[0.18em] text-text-placeholder">Prompt</div><div class="mt-1 text-[12px] text-text-tertiary">{cronjobPromptMeta(cronjobDetail.payload)}</div></div><div class="relative overflow-hidden rounded-[8px] bg-bg-elevated/40 ring-1 ring-border-subtle/60"><div class="absolute left-0 top-0 h-full w-[3px] bg-brand"></div><pre class="max-h-[460px] overflow-auto px-5 py-4 pl-6 text-[13px] leading-6 text-text-secondary whitespace-pre-wrap break-words">{formatCronjobPrompt(cronjobDetail.payload)}</pre></div></section>
									<section class="grid gap-3 sm:grid-cols-2"><div class="rounded-[7px] bg-bg-elevated/30 px-3 py-2.5"><div class="text-[10px] font-medium uppercase tracking-wider text-text-placeholder">Model</div><div class="mt-1 truncate text-[13px] text-text-primary">{payloadModelLabel(cronjobDetail.payload)}</div></div><div class="rounded-[7px] bg-bg-elevated/30 px-3 py-2.5"><div class="text-[10px] font-medium uppercase tracking-wider text-text-placeholder">Provider</div><div class="mt-1 font-mono text-[12px] text-text-secondary">{payloadProviderLabel(cronjobDetail.payload)}</div></div></section>
								{:else}
									<section class="space-y-2"><div class="text-[10px] font-medium uppercase tracking-[0.18em] text-text-placeholder">Payload</div><pre class="max-h-[520px] overflow-auto rounded-[8px] bg-bg-elevated/35 p-3 text-[12px] font-mono leading-relaxed text-text-secondary whitespace-pre-wrap break-all">{displaySafeJson(cronjobDetail.payload)}</pre></section>
								{/if}
							</div>
							<aside class="space-y-5 text-[13px]">
								<div class="space-y-3"><div class="text-[10px] font-medium uppercase tracking-[0.18em] text-text-placeholder">Schedule</div><div><div class="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wider text-text-placeholder"><Clock class="h-3.5 w-3.5" /> Expression</div><div class="mt-1.5 font-mono text-[15px] text-text-primary break-all">{cronjobDetail.cronExpression}</div></div><div><div class="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wider text-text-placeholder"><Clock3 class="h-3.5 w-3.5" /> Timezone</div><div class="mt-1.5 text-text-primary">{cronjobDetail.timezone}</div></div></div>
								<div class="h-px bg-border-subtle/70"></div>
								<div class="space-y-3"><div class="text-[10px] font-medium uppercase tracking-[0.18em] text-text-placeholder">Metadata</div><div class="grid grid-cols-[76px_minmax(0,1fr)] gap-x-3 gap-y-2 text-[12px]"><div class="text-text-placeholder">Type</div><div class="font-mono text-text-secondary break-all">{cronjobDetail.taskType}</div><div class="text-text-placeholder">Session</div><div class="font-mono text-text-secondary break-all">{cronjobDetail.sessionId ?? 'New session on run'}</div><div class="text-text-placeholder">Created</div><div class="text-text-secondary">{formatDateTime(cronjobDetail.createdAt)}</div><div class="text-text-placeholder">Updated</div><div class="text-text-secondary">{formatDateTime(cronjobDetail.updatedAt)}</div></div></div>
							</aside>
						</section>
					{/if}
					<section class="border-t border-border-subtle/70 pt-6">
						<div class="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"><div><div class="text-[10px] font-medium uppercase tracking-[0.18em] text-text-placeholder">Runs</div><div class="mt-1 text-[12px] text-text-tertiary">{cronjobRunsLoaded ? `${cronjobRuns.length} loaded · newest first` : 'Loads when this section is visible'}</div></div>{#if !cronjobRunsLoaded}<button type="button" class="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-[5px] border border-border-subtle px-3 py-2 text-[12px] text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary" onclick={() => loadCronjobRuns({ reset: true })} disabled={cronjobRunsLoading}>{#if cronjobRunsLoading}<Loader2 class="h-3.5 w-3.5 animate-spin" />{/if}<span>Load runs</span></button>{/if}</div>
						{#if cronjobRunsError}<div class="rounded-md border border-error-soft/30 bg-error-bg p-3 text-[12px] font-mono text-error-soft break-all">{cronjobRunsError}</div>{:else if cronjobRunsLoading && !cronjobRunsLoaded}<CenteredLoading label="Loading runs…" size="panel" />{:else if cronjobRuns.length > 0}<div class="divide-y divide-border-subtle/60">{#each cronjobRuns as run (run.id)}{@const badge = taskRunStatusBadge(run)}<a href={buildSpaceTaskRoute(spaceId, run.id)} class="block py-3 text-[12px] transition-colors hover:bg-bg-hover/70 sm:grid sm:grid-cols-[minmax(92px,0.8fr)_minmax(132px,1fr)_80px_minmax(0,1.5fr)] sm:items-center sm:gap-3 sm:py-2.5" onclick={(e) => { e.preventDefault(); goto(buildSpaceTaskRoute(spaceId, run.id)); }}><span class="flex items-center gap-2 px-1"><span class="h-[6px] w-[6px] shrink-0 rounded-full {badge.dot}"></span><span class="{badge.color}">{badge.label}</span></span><span class="mt-1 block font-mono text-text-placeholder sm:mt-0">{formatShortDateTime(run.scheduledAt ?? run.createdAt)}</span><span class="mt-1 block font-mono text-text-placeholder sm:mt-0">{taskRunDuration(run)}</span><span class="mt-1 block truncate text-[11px] {run.errorMessage ? 'text-status-error' : 'text-text-placeholder'} sm:mt-0" title={run.errorMessage ?? run.id}>{run.errorMessage ?? run.id}</span></a>{/each}</div>{#if cronjobRunsHasMore}<div class="mt-4"><button type="button" class="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-[5px] border border-border-subtle px-3 py-2 text-[12px] text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary sm:w-auto" onclick={() => loadCronjobRuns()} disabled={cronjobRunsLoadingMore}>{#if cronjobRunsLoadingMore}<Loader2 class="h-3.5 w-3.5 animate-spin" />{/if}<span>Load more</span></button></div>{/if}{:else if cronjobRunsLoaded}<div class="py-6 text-[13px] text-text-tertiary">Runs will appear here after the first scheduled execution.</div>{/if}
					</section>
				</div>
			{:else}
				<div class="text-[12px] text-text-tertiary">Cronjob not found.</div>
			{/if}
		</div>
	</div>
{/if}
