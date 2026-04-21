<script lang="ts">
import { goto } from "$app/navigation";
import { page } from "$app/state";
import { getSpace, getSpaceCheckpoint, type CheckpointRecord, type SpaceRecord } from "$lib/api";
import { ensureAuth } from "$lib/auth";
import { formatCheckpointTimestamp, getCheckpointTitle } from "$lib/checkpoints";
import { ArrowLeft, Copy, GitCommitHorizontal, Network, Clock3 } from "lucide-svelte";
import { onMount } from "svelte";

const currentPath = $derived(page.url.pathname);
const currentSearch = $derived(page.url.search);
const parts = $derived(currentPath.split("/"));
const spaceId = $derived(parts[2] ?? "");
const checkpointId = $derived(parts[4] ?? "");

let isLoading = $state(true);
let loadError = $state("");
let space = $state<SpaceRecord | null>(null);
let checkpoint = $state<CheckpointRecord | null>(null);
let copied = $state(false);
let copiedTimer: ReturnType<typeof setTimeout> | null = null;

async function loadPage() {
	if (!(await ensureAuth({ redirectPath: `${currentPath}${currentSearch}` }))) return;
	isLoading = true;
	loadError = "";

	try {
		const [spaceResult, checkpointResult] = await Promise.all([
			getSpace(spaceId),
			getSpaceCheckpoint(spaceId, checkpointId),
		]);
		space = spaceResult;
		checkpoint = checkpointResult.checkpoint;
	} catch (error) {
		loadError = error instanceof Error ? error.message : "Failed to load checkpoint";
	} finally {
		isLoading = false;
	}
}

onMount(() => {
	void loadPage();
	return () => {
		if (copiedTimer) clearTimeout(copiedTimer);
	};
});

async function handleCopyCommitHash() {
	if (!checkpoint) return;
	await navigator.clipboard.writeText(checkpoint.commitHash);
	copied = true;
	if (copiedTimer) clearTimeout(copiedTimer);
	copiedTimer = setTimeout(() => {
		copied = false;
	}, 1800);
}
</script>

<div class="flex-1 min-h-0 overflow-y-auto">
	<div class="h-[40px] flex items-center px-4 border-b border-border-subtle shrink-0 bg-bg-primary">
		<div class="flex items-center gap-3 min-w-0">
			<a
				href="/spaces/{spaceId}"
				class="text-text-tertiary hover:text-text-primary transition-colors shrink-0"
				onclick={(e) => {
					e.preventDefault();
					goto(`/spaces/${spaceId}`);
				}}
			>
				<ArrowLeft class="w-4 h-4" />
			</a>
			<div class="w-[1px] h-4 bg-border-subtle shrink-0"></div>
			<span class="text-[11px] font-medium text-text-secondary">Checkpoint Detail</span>
		</div>
	</div>

	<div class="p-4 max-w-3xl space-y-4">
		{#if isLoading}
			<div class="rounded-md border border-border-subtle bg-bg-surface p-4 text-[12px] text-text-tertiary">
				Loading checkpoint...
			</div>
		{:else if loadError}
			<div class="rounded-md border border-error-soft/30 bg-error-bg p-3 text-[12px] font-mono text-error-soft break-all">{loadError}</div>
		{:else if checkpoint && space}
			<div class="border border-border-subtle rounded-md bg-bg-surface p-5 space-y-4">
				<div class="space-y-1">
					<div class="text-[10px] uppercase tracking-wider text-text-placeholder font-medium">Checkpoint</div>
					<h1 class="text-[22px] font-semibold text-text-primary tracking-tight break-words">{getCheckpointTitle(checkpoint)}</h1>
					<p class="text-[13px] text-text-tertiary">Saved from <span class="text-text-primary">{space.name ?? space.title ?? space.id.slice(0, 12)}</span>.</p>
				</div>

				<div class="grid gap-3 md:grid-cols-2">
					<div class="rounded-[6px] border border-border-subtle bg-bg-elevated/40 p-3">
						<div class="flex items-center gap-2 text-[11px] uppercase tracking-wider text-text-placeholder font-medium">
							<GitCommitHorizontal class="w-3.5 h-3.5" />
							Commit Hash
						</div>
						<div class="mt-2 flex items-center justify-between gap-3">
							<div class="font-mono text-[13px] text-text-primary break-all">{checkpoint.commitHash}</div>
							<button
								type="button"
								class="shrink-0 inline-flex items-center gap-1.5 px-2 py-1 rounded-[5px] border border-border-subtle text-[11px] text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors"
								onclick={handleCopyCommitHash}
							>
								<Copy class="w-3 h-3" />
								<span>{copied ? "Copied" : "Copy"}</span>
							</button>
						</div>
					</div>

					<div class="rounded-[6px] border border-border-subtle bg-bg-elevated/40 p-3">
						<div class="flex items-center gap-2 text-[11px] uppercase tracking-wider text-text-placeholder font-medium">
							<Clock3 class="w-3.5 h-3.5" />
							Created At
						</div>
						<div class="mt-2 text-[13px] text-text-primary">{formatCheckpointTimestamp(checkpoint.createdAt)}</div>
					</div>

					<div class="rounded-[6px] border border-border-subtle bg-bg-elevated/40 p-3">
						<div class="flex items-center gap-2 text-[11px] uppercase tracking-wider text-text-placeholder font-medium">
							<Network class="w-3.5 h-3.5" />
							Parent Checkpoint
						</div>
						<div class="mt-2 font-mono text-[13px] text-text-primary break-all">{checkpoint.parentCheckpointId ?? "None"}</div>
					</div>

					<div class="rounded-[6px] border border-border-subtle bg-bg-elevated/40 p-3">
						<div class="text-[11px] uppercase tracking-wider text-text-placeholder font-medium">Fork Count</div>
						<div class="mt-2 text-[13px] text-text-primary">{checkpoint.forkCount}</div>
					</div>
				</div>

				<div class="rounded-[6px] border border-border-subtle bg-bg-elevated/20 p-4">
					<div class="text-[11px] uppercase tracking-wider text-text-placeholder font-medium">Description</div>
					<div class="mt-2 text-[14px] leading-6 text-text-primary whitespace-pre-wrap">{checkpoint.description?.trim() || "No description provided."}</div>
				</div>
			</div>
		{:else}
			<div class="rounded-md border border-border-subtle bg-bg-surface p-4 text-[12px] text-text-tertiary">Checkpoint not found.</div>
		{/if}
	</div>
</div>
