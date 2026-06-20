<script lang="ts">
import {
	type CheckpointRecord,
	HttpError,
	type SpaceRecord,
} from "@neta-art/cohub";
import {
	Activity,
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
import CenteredLoading from "$lib/components/CenteredLoading.svelte";
import { sdk } from "$lib/sdk";
import {
	buildSpaceNewSessionRoute,
	buildSpaceTaskRoute,
} from "$lib/space-routes";
import { asRecord } from "../space-utils";

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
let checkpointDetailError = $state("");
let checkpointIdCopied = $state(false);
let checkpointCopied = $state(false);
let checkpointCopiedTimer: ReturnType<typeof setTimeout> | null = null;
let checkpointIdCopiedTimer: ReturnType<typeof setTimeout> | null = null;
let checkpointCreateDescription = $state("");
let checkpointCreateSubmitting = $state(false);
let checkpointCreateError = $state("");

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

async function loadCheckpointDetail(targetCheckpointId: string) {
	const requestSpaceId = spaceId;
	const isCurrentRequest = () =>
		spaceId === requestSpaceId &&
		mode === "detail" &&
		checkpointId === targetCheckpointId;
	checkpointDetailLoading = true;
	checkpointDetailError = "";
	try {
		const { checkpoint } = await sdk
			.space(spaceId)
			.checkpoints.get(targetCheckpointId);
		if (!isCurrentRequest()) return;
		checkpointDetail = checkpoint;
		onDetailLoaded?.(checkpoint);
	} catch (error) {
		if (!isCurrentRequest()) return;
		checkpointDetail = null;
		onDetailLoaded?.(null);
		checkpointDetailError =
			error instanceof Error ? error.message : "Failed to load checkpoint";
	} finally {
		if (isCurrentRequest()) checkpointDetailLoading = false;
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
			checkpointCreateError = "Checkpoint save in progress.";
		} else {
			checkpointCreateError =
				error instanceof Error ? error.message : "Failed to save checkpoint";
		}
	} finally {
		checkpointCreateSubmitting = false;
	}
}

$effect(() => {
	if (mode === "detail" && checkpointId) {
		void loadCheckpointDetail(checkpointId);
		return;
	}
	checkpointDetail = null;
	onDetailLoaded?.(null);
});

onDestroy(() => {
	if (checkpointCopiedTimer) clearTimeout(checkpointCopiedTimer);
	if (checkpointIdCopiedTimer) clearTimeout(checkpointIdCopiedTimer);
});
</script>

{#if mode === "create"}
	<div class="flex-1 p-4 overflow-y-auto max-w-2xl">
		{#if spaceLoadError && !spaceHasMinimalAccess}
			<div class="rounded-md border border-error-soft/30 bg-error-bg p-3 text-[12px] font-mono text-error-soft break-all">{spaceLoadError}</div>
		{:else}
			<form onsubmit={handleCreateCheckpointSubmit} class="space-y-3">
				<div class="border border-border-subtle rounded-md bg-bg-surface p-4 space-y-3">
					<div>
						<div class="text-[10px] uppercase tracking-wider text-text-placeholder font-medium">Save</div>
						<p class="text-[13px] text-text-tertiary mt-1">Save the current workspace state of <span class="text-text-primary font-medium">{space?.name ?? space?.title ?? spaceId}</span> as a reusable checkpoint.</p>
					</div>
					<div>
						<label class="block text-[10px] font-medium uppercase tracking-wider text-text-tertiary mb-1.5" for="checkpoint-description">Description</label>
						<textarea
							id="checkpoint-description"
							bind:value={checkpointCreateDescription}
							rows="4"
							placeholder="What changed? What is this save for?"
							class="w-full px-3 py-[8px] rounded-[5px] bg-bg-input border border-border-subtle text-[13px] text-text-primary placeholder:text-text-placeholder focus:border-brand/40 focus:outline-none transition-colors resize-y"
						></textarea>
					</div>
					<div class="rounded-[6px] border border-border-subtle bg-bg-elevated/50 p-3 text-[12px] text-text-secondary">
						If left empty, the checkpoint will still be saved and shown using its commit hash.
					</div>
				</div>
				{#if checkpointCreateError}
					<div class="rounded-md border border-error-soft/30 bg-error-bg p-3 text-[12px] font-mono text-error-soft break-all">{checkpointCreateError}</div>
				{/if}
				<div class="flex items-center justify-end gap-2">
					<button
						type="button"
						class="px-3 py-2 rounded-[5px] border border-border-subtle text-[12px] text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors"
						onclick={() => goto(buildSpaceNewSessionRoute(spaceId))}
					>
						Cancel
					</button>
					<button
						type="submit"
						class="inline-flex items-center gap-2 px-3 py-2 rounded-[5px] bg-brand text-brand-contrast-fg text-[12px] font-medium hover:bg-brand-hover transition-colors disabled:opacity-50"
						disabled={checkpointCreateSubmitting}
					>
						{#if checkpointCreateSubmitting}
							<Loader2 class="w-3.5 h-3.5 animate-spin" />
						{:else}
							<Save class="w-3.5 h-3.5" />
						{/if}
						<span>Save Checkpoint</span>
					</button>
				</div>
			</form>
		{/if}
	</div>
{:else}
	<div class="flex-1 min-h-0 overflow-y-auto px-3 py-4 sm:px-6 sm:py-5 lg:px-8">
		<div class="max-w-4xl">
			{#if checkpointDetailLoading && checkpointDetail?.id !== checkpointId}
				<CenteredLoading label="Loading save…" size="panel" />
			{:else if checkpointDetailError}
				<div class="rounded-md border border-error-soft/30 bg-error-bg p-3 text-[12px] font-mono text-error-soft break-all">{checkpointDetailError}</div>
			{:else if checkpointDetail && checkpointDetail.id === checkpointId}
				{@const sourceTaskRunId = sourceTaskRunIdFromCheckpoint(checkpointDetail)}
				<div class="space-y-6 sm:space-y-8">
					<header class="flex flex-col gap-4 border-b border-border-subtle/70 pb-5 lg:flex-row lg:items-start lg:justify-between">
						<div class="min-w-0 space-y-3">
							<div class="flex flex-wrap items-center gap-2">
								<span class="inline-flex items-center gap-1.5 rounded-full bg-brand/10 px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-brand">
									<GitCommitHorizontal class="h-3 w-3" />
									Checkpoint
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
											<span class="text-text-secondary">Root checkpoint</span>
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
				<div class="text-[13px] text-text-tertiary">Checkpoint not found.</div>
			{/if}
		</div>
	</div>
{/if}
