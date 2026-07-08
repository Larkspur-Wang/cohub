<script lang="ts">
import type { WorkDetailResponse } from "@neta-art/cohub";
import WorkSurface from "$lib/components/work/WorkSurface.svelte";
import { buildWorkPwaMeta } from "$lib/work-pwa";

const props = $props<{
	data: Pick<WorkDetailResponse, "work" | "space" | "owner" | "content">;
}>();

const pwaMeta = $derived(buildWorkPwaMeta(props.data));
</script>

<svelte:head>
	<title>{pwaMeta.name}</title>
	<meta name="application-name" content={pwaMeta.shortName} />
	<meta name="apple-mobile-web-app-title" content={pwaMeta.shortName} />
	<meta name="description" content={pwaMeta.description} />
</svelte:head>

<WorkSurface
	work={props.data.work}
	space={props.data.space}
	owner={props.data.owner}
	content={props.data.content}
/>
