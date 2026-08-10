<script lang="ts">
import type { WorkComposerChip } from "@cohub/protocol/work-surface";
import WorkSurface from "$lib/components/work/WorkSurface.svelte";
import { sdk } from "$lib/sdk";
import type { CohubWorkUrl } from "$lib/work-url";

type Props = {
	workUrl: CohubWorkUrl;
	onComposerChip?: (workId: string, chip: WorkComposerChip | null) => void;
};

const { workUrl, onComposerChip }: Props = $props();

let state = $state<
	| { status: "loading" }
	| {
			status: "ready";
			data: Awaited<ReturnType<typeof sdk.works.getBySlug>>;
	  }
	| { status: "error" }
>({ status: "loading" });
let loadVersion = 0;

$effect(() => {
	const version = ++loadVersion;
	state = { status: "loading" };
	void sdk.works
		.getBySlug(workUrl.username, workUrl.spaceSlug, workUrl.workSlug)
		.then((data) => {
			if (version !== loadVersion) return;
			state = { status: "ready", data };
		})
		.catch(() => {
			if (version !== loadVersion) return;
			state = { status: "error" };
		});
});
</script>

{#if state.status === "ready"}
	{@const data = state.data}
	<WorkSurface
		mode="background"
		work={data.work}
		space={data.space}
		owner={data.owner}
		content={data.content ?? null}
		launchState={workUrl}
		onComposerChip={(chip) => onComposerChip?.(data.work.id, chip)}
	/>
{:else if state.status === "error"}
	<div class="work-background-state">Work background is unavailable.</div>
{:else}
	<div class="work-background-state" aria-hidden="true"></div>
{/if}

<style>
	.work-background-state {
		display: flex;
		width: 100%;
		height: 100%;
		align-items: center;
		justify-content: center;
		background: var(--bg-content);
		font-size: 0.875rem;
		color: var(--text-tertiary);
	}
</style>
