<script lang="ts">
import {
	type CheckpointDiffFileResponse,
	type CheckpointDiffSummary,
	type CheckpointRecord,
	HttpError,
	type SpacePendingDiffSummary,
	type SpaceRecord,
} from "@neta-art/cohub";
import {
	Activity,
	BarChart3,
	Check,
	Copy,
	GitCommitHorizontal,
	Loader2,
	Network,
	Rocket,
	Save,
} from "lucide-svelte";
import { onDestroy } from "svelte";
import { goto } from "$app/navigation";
import { page } from "$app/state";
import type { AccessState } from "$lib/access/access-state";
import { classifyAccessError } from "$lib/access/access-state";
import AccessStateView from "$lib/components/AccessStateView.svelte";
import CenteredLoading from "$lib/components/CenteredLoading.svelte";
import CheckpointDiffPanel from "$lib/components/CheckpointDiffPanel.svelte";
import { sdk } from "$lib/sdk";
import {
	buildSpaceNewSessionRoute,
	buildSpaceTaskRoute,
} from "$lib/space-routes";
import { asRecord } from "../space-utils";
import { createKeyedRouteRequestGuard } from "./route-request-guard";

type Props = {
	mode: "create" | "detail";
	spaceId: string;
	space: SpaceRecord | null;
	spaceLoadError: string;
	spaceHasMinimalAccess: boolean;
	checkpointId: string | null;
	onDetailLoaded?: (checkpoint: CheckpointRecord | null) => void;
};

let {
	mode,
	spaceId,
	space,
	spaceLoadError,
	spaceHasMinimalAccess,
	checkpointId,
	onDetailLoaded,
}: Props = $props();

let checkpointDetail = $state<CheckpointRecord | null>(null);
let checkpointDetailLoading = $state(false);
let checkpointDetailError = $state<AccessState | null>(null);
let checkpointIdCopied = $state(false);
let checkpointCopied = $state(false);
let checkpointCopiedTimer: ReturnType<typeof setTimeout> | null = null;
let checkpointIdCopiedTimer: ReturnType<typeof setTimeout> | null = null;
let checkpointCreateDescription = $state("");
let checkpointCreateSubmitting = $state(false);
let checkpointCreateError = $state("");

let detailDiff = $state<CheckpointDiffSummary | null>(null);
let detailDiffLoading = $state(false);
let detailDiffError = $state<string | null>(null);
let detailDiffBase = $state<string | null>(null);

let compareOpen = $state(false);
let compareOptions = $state<CheckpointRecord[]>([]);
let compareOptionsLoading = $state(false);
let compareOptionsLoaded = $state(false);

let pendingDiff = $state<SpacePendingDiffSummary | null>(null);
let pendingDiffLoading = $state(false);
let pendingDiffError = $state<string | null>(null);

function formatCheckpointTimestamp(dateStr: string | null | undefined): string {
	if (!dateStr) return "—";
	const d = new Date(dateStr);
	return d.toLocaleString("en-US", {
		month: "short",
		day: "numeric",
		year: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	});
}

function sourceTaskRunIdFromCheckpoint(
	checkpoint: CheckpointRecord | null | undefined,
): string | null {
	const meta = asRecord(checkpoint?.meta);
	const sourceTaskRunId = meta?.sourceTaskRunId;
	return typeof sourceTaskRunId === "string" && sourceTaskRunId.trim()
		? sourceTaskRunId
		: null;
}

function readCheckpointStat(
	checkpoint: CheckpointRecord | null | undefined,
	key: string,
): number | null {
	const stats = asRecord(asRecord(checkpoint?.meta)?.stats);
	const value = stats?.[key];
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function formatCheckpointCount(value: number | null): string {
	return value === null ? "—" : value.toLocaleString("en-US");
}

function formatCheckpointBytes(value: number | null): string {
	if (value === null) return "—";
	return new Intl.NumberFormat("en-US", {
		maximumFractionDigits: value >= 1024 * 1024 ? 1 : 0,
		style: "unit",
		unit: "byte",
		unitDisplay: "narrow",
		notation: value >= 1024 * 1024 ? "compact" : "standard",
	}).format(value);
}

function checkpointErrorMessage(error: unknown): AccessState {
	return classifyAccessError(error);
}

function compareBaseFromUrl(): string | null {
	const raw = page.url.searchParams.get("base")?.trim();
	return raw ? raw : null;
}

async function loadCheckpointDetail(targetCheckpointId: string) {
	const base = compareBaseFromUrl();
	const guard = createKeyedRouteRequestGuard({
		captureKey: () => `${spaceId}:${mode}:${checkpointId ?? ""}:${base ?? ""}`,
	});
	checkpointDetailLoading = true;
	checkpointDetailError = null;
	detailDiff = null;
	detailDiffError = null;
	detailDiffBase = null;
	detailDiffLoading = true;
	try {
		// Parallel: checkpoint record + precomputed/on-demand summary.
		const [detailResult, diffResult] = await Promise.allSettled([
			sdk.space(spaceId).checkpoints.get(targetCheckpointId),
			sdk
				.space(spaceId)
				.checkpoints(targetCheckpointId)
				.diff.summary(base ? { base } : undefined),
		]);
		if (!guard.isCurrent()) return;

		if (detailResult.status === "fulfilled") {
			checkpointDetail = detailResult.value.checkpoint;
			onDetailLoaded?.(detailResult.value.checkpoint);
		} else {
			checkpointDetail = null;
			onDetailLoaded?.(null);
			checkpointDetailError = checkpointErrorMessage(detailResult.reason);
		}

		if (diffResult.status === "fulfilled") {
			detailDiff = diffResult.value;
			detailDiffBase = base ?? diffResult.value.baseCheckpointId;
			detailDiffError = null;
		} else if (detailResult.status === "fulfilled") {
			detailDiff = null;
			detailDiffError =
				diffResult.reason instanceof Error
					? diffResult.reason.message
					: "Failed to load changes";
		}
	} finally {
		if (guard.isCurrent()) {
			checkpointDetailLoading = false;
			detailDiffLoading = false;
		}
	}
}

async function loadDetailFileDiff(
	path: string,
): Promise<CheckpointDiffFileResponse | null> {
	if (!checkpointId) return null;
	try {
		return await sdk
			.space(spaceId)
			.checkpoints(checkpointId)
			.diff.file(path, detailDiffBase ? { base: detailDiffBase } : undefined);
	} catch {
		return null;
	}
}

async function loadCompareOptions() {
	if (compareOptionsLoaded || compareOptionsLoading) return;
	compareOptionsLoading = true;
	try {
		const result = await sdk.space(spaceId).checkpoints.list({ limit: 30 });
		compareOptions = result.checkpoints.filter((cp) => cp.id !== checkpointId);
		compareOptionsLoaded = true;
	} catch {
		compareOptions = [];
	} finally {
		compareOptionsLoading = false;
	}
}

function openComparePicker() {
	compareOpen = !compareOpen;
	if (compareOpen) void loadCompareOptions();
}

function applyCompareBase(baseId: string | null) {
	if (!checkpointId) return;
	const url = new URL(page.url);
	if (baseId) url.searchParams.set("base", baseId);
	else url.searchParams.delete("base");
	compareOpen = false;
	void goto(`${url.pathname}${url.search}`, {
		replaceState: true,
		noScroll: true,
		keepFocus: true,
	});
}

function compareLabel(cp: CheckpointRecord): string {
	const title = cp.description?.trim() || cp.commitHash.slice(0, 12);
	return title.length > 48 ? `${title.slice(0, 48)}…` : title;
}

/** Lazy: only runs when the user expands Review changes. */
async function loadPendingDiff() {
	if (pendingDiff || pendingDiffLoading) return;
	const guard = createKeyedRouteRequestGuard({
		captureKey: () => `${spaceId}:${mode}:pending`,
	});
	pendingDiffLoading = true;
	pendingDiffError = null;
	try {
		const summary = await sdk.space(spaceId).files.diff();
		if (!guard.isCurrent()) return;
		pendingDiff = summary;
	} catch (error) {
		if (!guard.isCurrent()) return;
		pendingDiff = null;
		pendingDiffError =
			error instanceof Error ? error.message : "Failed to load pending changes";
	} finally {
		if (guard.isCurrent()) pendingDiffLoading = false;
	}
}

async function loadPendingFileDiff(
	path: string,
): Promise<CheckpointDiffFileResponse | null> {
	try {
		return await sdk.space(spaceId).files.diffFile(path);
	} catch {
		return null;
	}
}

async function handleCopyCheckpointId() {
	if (!checkpointDetail) return;
	await navigator.clipboard.writeText(checkpointDetail.id);
	checkpointIdCopied = true;
	if (checkpointIdCopiedTimer) clearTimeout(checkpointIdCopiedTimer);
	checkpointIdCopiedTimer = setTimeout(() => {
		checkpointIdCopied = false;
	}, 1800);
}

async function handleCopyCheckpointCommitHash() {
	if (!checkpointDetail) return;
	await navigator.clipboard.writeText(checkpointDetail.commitHash);
	checkpointCopied = true;
	if (checkpointCopiedTimer) clearTimeout(checkpointCopiedTimer);
	checkpointCopiedTimer = setTimeout(() => {
		checkpointCopied = false;
	}, 1800);
}

async function handleForkCheckpoint() {
	if (!checkpointDetail) return;
	await goto(
		`/spaces/new?checkpointId=${encodeURIComponent(checkpointDetail.id)}`,
	);
}

async function handleCreateCheckpointSubmit(event: SubmitEvent) {
	event.preventDefault();
	if (checkpointCreateSubmitting) return;
	checkpointCreateError = "";
	checkpointCreateSubmitting = true;
	try {
		const { taskRunId } = await sdk
			.space(spaceId)
			.checkpoints.create(checkpointCreateDescription.trim() || null);
		await goto(buildSpaceTaskRoute(spaceId, taskRunId));
	} catch (error) {
		if (error instanceof HttpError && error.status === 409) {
			checkpointCreateError = "Save in progress.";
		} else {
			checkpointCreateError =
				error instanceof Error ? error.message : "Failed to create Save";
		}
	} finally {
		checkpointCreateSubmitting = false;
	}
}

$effect(() => {
	// Re-run when ?base= changes so arbitrary checkpoint compare stays in sync.
	const base = page.url.searchParams.get("base");
	if (mode === "detail" && checkpointId) {
		void loadCheckpointDetail(checkpointId);
		return;
	}
	void base;
	checkpointDetail = null;
	onDetailLoaded?.(null);
	detailDiff = null;
	detailDiffError = null;
});

$effect(() => {
	// Create mode: pending scan waits for explicit expand (NFS-friendly).
	// Reset when leaving create so a later re-entry doesn't reuse stale summary.
	if (mode !== "create" || !space || spaceHasMinimalAccess || spaceLoadError) {
		pendingDiff = null;
		pendingDiffError = null;
		pendingDiffLoading = false;
	}
});

onDestroy(() => {
	if (checkpointCopiedTimer) clearTimeout(checkpointCopiedTimer);
	if (checkpointIdCopiedTimer) clearTimeout(checkpointIdCopiedTimer);
});
</script>

{#if mode === "create"}
	<div class="flex-1 overflow-y-auto">
		<div class="mx-auto w-full max-w-xl px-4 py-6 sm:px-6 sm:py-8">
			{#if spaceLoadError && !spaceHasMinimalAccess}
				<AccessStateView
					state={{ kind: "error", message: spaceLoadError }}
					size="compact"
				/>
			{:else}
				<form onsubmit={handleCreateCheckpointSubmit} class="space-y-6">
					<header class="space-y-1.5">
						<div class="text-[10px] font-medium uppercase tracking-wider text-text-placeholder">New save</div>
						<h1 class="text-[18px] font-semibold tracking-tight text-text-primary sm:text-[20px]">
							Save workspace
						</h1>
						<p class="text-[13px] leading-5 text-text-tertiary">
							Create a reusable Save of
							<span class="font-medium text-text-secondary">{space?.name ?? space?.title ?? spaceId}</span>.
						</p>
					</header>

					<div class="space-y-2">
						<label
							class="block text-[11px] font-medium text-text-secondary"
							for="checkpoint-description"
						>Description <span class="font-normal text-text-placeholder">optional</span></label
						>
						<textarea
							id="checkpoint-description"
							bind:value={checkpointCreateDescription}
							rows="3"
							placeholder="What changed?"
							class="w-full resize-y rounded-[6px] border border-border-subtle bg-bg-input px-3 py-2.5 text-[13px] leading-5 text-text-primary placeholder:text-text-placeholder focus:border-brand/40 focus:outline-none transition-colors"
						></textarea>
						<p class="text-[11px] leading-4 text-text-placeholder">
							Empty descriptions fall back to the commit hash in lists.
						</p>
					</div>

					<!-- Pending preview: collapsed by default; expand triggers NFS-light scan. -->
					<div class="border-t border-border-subtle/60 pt-4">
						<CheckpointDiffPanel
							summary={pendingDiff}
							loading={pendingDiffLoading}
							error={pendingDiffError}
							emptyLabel={space?.headCheckpointId ? "No changes since last save" : "Workspace will be saved as-is"}
							collapsible={true}
							defaultExpanded={false}
							title="Review changes"
							onExpand={loadPendingDiff}
							loadFile={loadPendingFileDiff}
						/>
					</div>

					{#if checkpointCreateError}
						<div class="rounded-[6px] border border-error-soft/30 bg-error-bg px-3 py-2.5 text-[12px] font-mono text-error-soft break-all">
							{checkpointCreateError}
						</div>
					{/if}

					<div class="flex items-center justify-end gap-2 pt-1">
						<button
							type="button"
							class="min-h-9 rounded-[6px] px-3 py-2 text-[12px] text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-primary"
							onclick={() => goto(buildSpaceNewSessionRoute(spaceId))}
						>
							Cancel
						</button>
						<button
							type="submit"
							class="inline-flex min-h-9 items-center gap-2 rounded-[6px] bg-brand px-3.5 py-2 text-[12px] font-medium text-brand-contrast-fg transition-colors hover:bg-brand-hover disabled:opacity-50"
							disabled={checkpointCreateSubmitting}
						>
							{#if checkpointCreateSubmitting}
								<Loader2 class="h-3.5 w-3.5 animate-spin" />
							{:else}
								<Save class="h-3.5 w-3.5" />
							{/if}
							<span>Save</span>
						</button>
					</div>
				</form>
			{/if}
		</div>
	</div>
{:else}
	<div class="flex-1 min-h-0 overflow-y-auto px-3 py-4 sm:px-6 sm:py-5 lg:px-8">
		<div class="max-w-4xl">
			{#if checkpointDetailLoading && checkpointDetail?.id !== checkpointId}
				<CenteredLoading label="Loading save…" size="panel" />
			{:else if checkpointDetailError}
				<AccessStateView
					state={checkpointDetailError}
					size="compact"
				/>
			{:else if checkpointDetail && checkpointDetail.id === checkpointId}
				{@const sourceTaskRunId = sourceTaskRunIdFromCheckpoint(checkpointDetail)}
				{@const fileCount = readCheckpointStat(checkpointDetail, "fileCount")}
				{@const changedFileCount = readCheckpointStat(checkpointDetail, "changedFileCount")}
				{@const fileBytes = readCheckpointStat(checkpointDetail, "fileBytes")}
				{@const addedFileCount = readCheckpointStat(checkpointDetail, "addedFileCount")}
				{@const modifiedFileCount = readCheckpointStat(checkpointDetail, "modifiedFileCount")}
				{@const deletedFileCount = readCheckpointStat(checkpointDetail, "deletedFileCount")}
				{@const renamedFileCount = readCheckpointStat(checkpointDetail, "renamedFileCount")}
				{@const copiedFileCount = readCheckpointStat(checkpointDetail, "copiedFileCount")}
				<div class="space-y-6 sm:space-y-8">
					<header class="flex flex-col gap-4 border-b border-border-subtle/70 pb-5 lg:flex-row lg:items-start lg:justify-between">
						<div class="min-w-0 space-y-3">
							<div class="flex flex-wrap items-center gap-2">
								<span class="inline-flex items-center gap-1.5 rounded-full bg-brand/10 px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-brand">
									<GitCommitHorizontal class="h-3 w-3" />
									Save
								</span>
								<span class="font-mono text-[11px] text-text-placeholder">{formatCheckpointTimestamp(checkpointDetail.createdAt)}</span>
							</div>
							<div class="space-y-2">
								<h1 class="font-mono text-[18px] font-semibold leading-snug tracking-tight text-text-primary break-all sm:text-[22px]">{checkpointDetail.id}</h1>
								{#if checkpointDetail.description?.trim()}
									<p class="max-w-2xl text-[14px] leading-6 text-text-secondary">{checkpointDetail.description.trim()}</p>
								{:else}
									<p class="text-[13px] text-text-tertiary">Saved from <span class="text-text-primary">{space?.name ?? space?.title ?? spaceId}</span>.</p>
								{/if}
							</div>
						</div>
						<div class="flex shrink-0 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
							<button
								type="button"
								class="inline-flex min-h-9 w-full items-center justify-center gap-1.5 rounded-[5px] bg-brand-muted px-3 py-2 text-[12px] font-medium text-brand transition-colors hover:bg-brand-muted-hover sm:w-auto"
								onclick={handleForkCheckpoint}
							>
								<Rocket class="w-3.5 h-3.5" />
								<span>New space</span>
							</button>
							<button
								type="button"
								class="inline-flex min-h-9 w-full items-center justify-center gap-1.5 rounded-[5px] px-3 py-2 text-[12px] font-medium text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-primary sm:w-auto"
								onclick={handleCopyCheckpointId}
							>
								{#if checkpointIdCopied}
									<Check class="w-3.5 h-3.5 text-success-soft" />
									<span class="text-success-soft">Copied</span>
								{:else}
									<Copy class="w-3.5 h-3.5" />
									<span>Copy ID</span>
								{/if}
							</button>
						</div>
					</header>

					<section class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_240px] lg:gap-8">
						<div class="min-w-0 space-y-5">
							<div class="space-y-2">
								<div class="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wider text-text-placeholder">
									<GitCommitHorizontal class="w-3.5 h-3.5 shrink-0" />
									Commit
								</div>
								<div class="group flex flex-col gap-2 rounded-[6px] bg-bg-elevated/35 px-3 py-2.5 sm:flex-row sm:items-start sm:justify-between">
									<div class="min-w-0 font-mono text-[12px] leading-snug text-text-secondary break-all">{checkpointDetail.commitHash}</div>
									<button
										type="button"
										class="shrink-0 rounded-[4px] p-1.5 text-text-placeholder transition-colors hover:bg-bg-hover hover:text-text-secondary"
										onclick={handleCopyCheckpointCommitHash}
										title="Copy commit hash"
									>
										{#if checkpointCopied}
											<Check class="w-3 h-3 text-success-soft" />
										{:else}
											<Copy class="w-3 h-3" />
										{/if}
									</button>
								</div>
							</div>

							<div class="space-y-2">
								<div class="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wider text-text-placeholder">
									<BarChart3 class="w-3.5 h-3.5 shrink-0" />
									Stats
								</div>
								<div class="rounded-[6px] bg-bg-elevated/25 px-3 py-3">
									<div class="grid grid-cols-3 gap-x-4 gap-y-3">
										<div class="min-w-0">
											<div class="text-[10px] uppercase tracking-wider text-text-placeholder">Files</div>
											<div class="mt-1 font-mono text-[16px] font-semibold tabular-nums text-text-primary">{formatCheckpointCount(fileCount)}</div>
										</div>
										<div class="min-w-0">
											<div class="text-[10px] uppercase tracking-wider text-text-placeholder">Changed</div>
											<div class="mt-1 font-mono text-[16px] font-semibold tabular-nums text-text-primary">{formatCheckpointCount(changedFileCount)}</div>
										</div>
										<div class="min-w-0">
											<div class="text-[10px] uppercase tracking-wider text-text-placeholder">Size</div>
											<div class="mt-1 font-mono text-[16px] font-semibold tabular-nums text-text-primary">{formatCheckpointBytes(fileBytes)}</div>
										</div>
									</div>
									<div class="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-border-subtle/60 pt-3 text-[12px] sm:grid-cols-5">
										<div class="flex items-center justify-between gap-2 sm:block">
											<span class="text-text-tertiary">Added</span>
											<span class="font-mono tabular-nums text-text-secondary sm:mt-1 sm:block">{formatCheckpointCount(addedFileCount)}</span>
										</div>
										<div class="flex items-center justify-between gap-2 sm:block">
											<span class="text-text-tertiary">Modified</span>
											<span class="font-mono tabular-nums text-text-secondary sm:mt-1 sm:block">{formatCheckpointCount(modifiedFileCount)}</span>
										</div>
										<div class="flex items-center justify-between gap-2 sm:block">
											<span class="text-text-tertiary">Deleted</span>
											<span class="font-mono tabular-nums text-text-secondary sm:mt-1 sm:block">{formatCheckpointCount(deletedFileCount)}</span>
										</div>
										<div class="flex items-center justify-between gap-2 sm:block">
											<span class="text-text-tertiary">Renamed</span>
											<span class="font-mono tabular-nums text-text-secondary sm:mt-1 sm:block">{formatCheckpointCount(renamedFileCount)}</span>
										</div>
										<div class="flex items-center justify-between gap-2 sm:block">
											<span class="text-text-tertiary">Copied</span>
											<span class="font-mono tabular-nums text-text-secondary sm:mt-1 sm:block">{formatCheckpointCount(copiedFileCount)}</span>
										</div>
									</div>
								</div>
							</div>

							<div class="space-y-2">
								<div class="flex flex-wrap items-center gap-x-3 gap-y-1">
									{#if detailDiffBase && detailDiffBase !== checkpointDetail.parentCheckpointId}
										<div class="text-[12px] text-text-tertiary">
											Comparing against
											<a
												href="/spaces/{spaceId}/checkpoints/{detailDiffBase}"
												class="font-mono text-[11px] text-brand transition-colors hover:text-brand-hover"
												data-sveltekit-preload-data="hover"
											>{detailDiffBase.slice(0, 8)}</a>
											<button
												type="button"
												class="ml-1 text-[11px] text-text-placeholder transition-colors hover:text-text-secondary"
												onclick={() => applyCompareBase(null)}
											>Reset</button
											>
										</div>
									{:else if checkpointDetail.parentCheckpointId}
										<div class="text-[12px] text-text-placeholder">vs parent</div>
									{/if}
									<div class="relative ml-auto">
										<button
											type="button"
											class="inline-flex min-h-7 items-center gap-1 rounded-[5px] px-2 py-1 text-[11px] text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-secondary"
											onclick={openComparePicker}
											aria-expanded={compareOpen}
										>
											Compare
										</button>
										{#if compareOpen}
											<div
												class="absolute right-0 z-20 mt-1 w-[min(18rem,calc(100vw-2rem))] overflow-hidden rounded-[6px] border border-border-subtle bg-bg-surface shadow-lg"
												role="listbox"
											>
												<div class="border-b border-border-subtle/60 px-2.5 py-1.5 text-[10px] font-medium uppercase tracking-wider text-text-placeholder">
													Compare against
												</div>
												{#if checkpointDetail.parentCheckpointId}
													<button
														type="button"
														class="flex w-full items-center justify-between gap-2 px-2.5 py-2 text-left text-[12px] text-text-secondary transition-colors hover:bg-bg-hover"
														onclick={() => applyCompareBase(null)}
													>
														<span>Parent (default)</span>
														{#if !detailDiffBase || detailDiffBase === checkpointDetail.parentCheckpointId}
															<span class="text-[10px] text-brand">Active</span>
														{/if}
													</button>
												{/if}
												<div class="max-h-56 overflow-y-auto overscroll-contain [scrollbar-width:thin]">
													{#if compareOptionsLoading && compareOptions.length === 0}
														<div class="flex items-center gap-2 px-2.5 py-3 text-[12px] text-text-tertiary">
															<Loader2 class="h-3.5 w-3.5 animate-spin" />
															Loading…
														</div>
													{:else if compareOptions.length === 0}
														<div class="px-2.5 py-3 text-[12px] text-text-tertiary">No other saves</div>
													{:else}
														{#each compareOptions as cp (cp.id)}
															<button
																type="button"
																class="flex w-full min-w-0 flex-col gap-0.5 px-2.5 py-2 text-left transition-colors hover:bg-bg-hover {detailDiffBase === cp.id ? 'bg-bg-active' : ''}"
																onclick={() => applyCompareBase(cp.id)}
															>
																<span class="truncate text-[12px] text-text-secondary">{compareLabel(cp)}</span>
																<span class="font-mono text-[10px] text-text-placeholder">{formatCheckpointTimestamp(cp.createdAt)}</span>
															</button>
														{/each}
													{/if}
												</div>
											</div>
										{/if}
									</div>
								</div>
								<CheckpointDiffPanel
									summary={detailDiff}
									loading={detailDiffLoading}
									error={detailDiffError}
									emptyLabel={checkpointDetail.parentCheckpointId ? "No changes from parent" : "Initial save"}
									cacheKey={`${checkpointDetail.id}:${detailDiffBase ?? "parent"}`}
									loadFile={loadDetailFileDiff}
								/>
							</div>

							<div class="space-y-2">
								<div class="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wider text-text-placeholder">
									<Network class="w-3.5 h-3.5 shrink-0" />
									Lineage
								</div>
								<div class="space-y-2 text-[13px]">
									<div class="flex items-start gap-3">
										<span class="w-20 shrink-0 text-text-tertiary">Parent</span>
										{#if checkpointDetail.parentCheckpointId}
											<a
												href="/spaces/{spaceId}/checkpoints/{checkpointDetail.parentCheckpointId}"
												class="min-w-0 font-mono text-[12px] leading-snug text-brand transition-colors hover:text-brand-hover break-all"
												data-sveltekit-preload-data="hover"
											>{checkpointDetail.parentCheckpointId}</a>
										{:else}
											<span class="text-text-secondary">Root save</span>
										{/if}
									</div>
									<div class="flex items-start gap-3">
										<span class="w-20 shrink-0 text-text-tertiary">Forks</span>
										<span class="text-text-secondary">{checkpointDetail.forkCount}</span>
									</div>
								</div>
							</div>
						</div>

						<aside class="space-y-3 text-[12px] text-text-tertiary">
							<div class="space-y-1.5">
								<div class="text-[10px] font-medium uppercase tracking-wider text-text-placeholder">Saved from</div>
								<div class="truncate text-text-secondary" title={space?.name ?? space?.title ?? spaceId}>{space?.name ?? space?.title ?? spaceId}</div>
							</div>
							{#if sourceTaskRunId}
								<a
									href={buildSpaceTaskRoute(spaceId, sourceTaskRunId)}
									class="inline-flex items-center gap-1.5 text-text-tertiary transition-colors hover:text-brand"
									onclick={(e) => { e.preventDefault(); goto(buildSpaceTaskRoute(spaceId, sourceTaskRunId)); }}
								>
									<Activity class="w-3.5 h-3.5" />
									<span>View save task</span>
								</a>
							{/if}
						</aside>
					</section>
				</div>
			{:else}
				<div class="text-[13px] text-text-tertiary">Save not found.</div>
			{/if}
		</div>
	</div>
{/if}
