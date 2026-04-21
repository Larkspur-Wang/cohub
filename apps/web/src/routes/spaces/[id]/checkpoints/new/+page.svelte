<script lang="ts">
import { goto } from "$app/navigation";
import { page } from "$app/state";
import { ensureAuth } from "$lib/auth";
import { createSpaceCheckpoint, getSpace } from "$lib/api";
import { pollCheckpointJob } from "$lib/checkpoints";
import { ArrowLeft, Loader2, Save } from "lucide-svelte";
import { onMount } from "svelte";

const currentPath = $derived(page.url.pathname);
const currentSearch = $derived(page.url.search);
const spaceId = $derived(currentPath.split("/")[2] ?? "");

let isLoading = $state(true);
let isSubmitting = $state(false);
let loadError = $state("");
let submitError = $state("");
let description = $state("");
let spaceName = $state("");

async function loadPage() {
	if (!(await ensureAuth({ redirectPath: `${currentPath}${currentSearch}` }))) return;
	isLoading = true;
	loadError = "";

	try {
		const space = await getSpace(spaceId);
		spaceName = space.name ?? space.title ?? space.id.slice(0, 12);
	} catch (error) {
		loadError = error instanceof Error ? error.message : "Failed to load space";
	} finally {
		isLoading = false;
	}
}

onMount(() => {
	void loadPage();
});

async function handleSubmit(event: SubmitEvent) {
	event.preventDefault();
	if (isSubmitting) return;

	submitError = "";
	isSubmitting = true;

	try {
		const { jobId } = await createSpaceCheckpoint(spaceId, description.trim() || null);
		const run = await pollCheckpointJob(jobId);
		const checkpointId =
			typeof run.result === "object" &&
			run.result !== null &&
			"checkpointId" in run.result &&
			typeof run.result.checkpointId === "string"
				? run.result.checkpointId
				: null;

		window.dispatchEvent(
			new CustomEvent("cohub:checkpoints-updated", { detail: { spaceId } }),
		);

		if (checkpointId) {
			await goto(`/spaces/${spaceId}/checkpoints/${checkpointId}`);
			return;
		}

		await goto(`/spaces/${spaceId}`);
	} catch (error) {
		submitError =
			error instanceof Error ? error.message : "Failed to save checkpoint";
	} finally {
		isSubmitting = false;
	}
}
</script>

<div class="flex-1 flex flex-col min-h-0 overflow-y-auto">
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
			<span class="text-[11px] font-medium text-text-secondary">New Checkpoint</span>
		</div>
	</div>

	<div class="flex-1 p-4 overflow-y-auto max-w-2xl">
		{#if isLoading}
			<div class="flex items-center justify-center py-12 text-[12px] text-text-tertiary">
				<Loader2 class="w-4 h-4 animate-spin mr-2" />
				Loading form...
			</div>
		{:else if loadError}
			<div class="rounded-md border border-error-soft/30 bg-error-bg p-3 text-[12px] font-mono text-error-soft break-all">{loadError}</div>
		{:else}
			<form onsubmit={handleSubmit} class="space-y-3">
				<div class="border border-border-subtle rounded-md bg-bg-surface p-4 space-y-3">
					<div>
						<div class="text-[10px] uppercase tracking-wider text-text-placeholder font-medium">Checkpoint</div>
						<p class="text-[13px] text-text-tertiary mt-1">Save the current workspace state of <span class="text-text-primary font-medium">{spaceName}</span> as a reusable checkpoint.</p>
					</div>

					<div>
						<label class="block text-[10px] font-medium uppercase tracking-wider text-text-tertiary mb-1.5" for="checkpoint-description">Description</label>
						<textarea
							id="checkpoint-description"
							bind:value={description}
							rows="4"
							placeholder="What changed? What is this checkpoint for?"
							class="w-full px-3 py-[8px] rounded-[5px] bg-bg-input border border-border-subtle text-[13px] text-text-primary placeholder:text-text-placeholder focus:border-brand/40 focus:outline-none transition-colors resize-y"
						></textarea>
					</div>

					<div class="rounded-[6px] border border-border-subtle bg-bg-elevated/50 p-3 text-[12px] text-text-secondary">
						If left empty, the checkpoint will still be saved and shown using its commit hash.
					</div>
				</div>

				{#if submitError}
					<div class="rounded-md border border-error-soft/30 bg-error-bg p-3 text-[12px] font-mono text-error-soft break-all">{submitError}</div>
				{/if}

				<div class="flex items-center justify-end gap-2">
					<button
						type="button"
						class="px-3 py-2 rounded-[5px] border border-border-subtle text-[12px] text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors"
						onclick={() => goto(`/spaces/${spaceId}`)}
					>
						Cancel
					</button>
					<button
						type="submit"
						class="inline-flex items-center gap-2 px-3 py-2 rounded-[5px] bg-brand text-white text-[12px] font-medium hover:bg-brand-hover transition-colors disabled:opacity-50"
						disabled={isSubmitting}
					>
						{#if isSubmitting}
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
</div>
