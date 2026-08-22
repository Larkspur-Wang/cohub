<script lang="ts">
import type { AppComposerChip } from "@cohub/protocol/app-surface";
import type { CohubAppUrl } from "$lib/app-url";
import AppSurface from "$lib/components/app/AppSurface.svelte";
import { sdk } from "$lib/sdk";

type Props = {
	appUrl: CohubAppUrl;
	onComposerChip?: (appId: string, chip: AppComposerChip | null) => void;
};

const { appUrl, onComposerChip }: Props = $props();

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
		.getBySlug(appUrl.username, appUrl.spaceSlug, appUrl.appSlug)
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
	<AppSurface
		mode="background"
		app={data.app}
		space={data.space}
		owner={data.owner}
		content={data.content ?? null}
		launchState={appUrl}
		onComposerChip={(chip) => onComposerChip?.(data.app.id, chip)}
	/>
{:else if state.status === "error"}
	<div class="work-background-state">App background is unavailable.</div>
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
