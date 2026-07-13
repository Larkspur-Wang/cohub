<script lang="ts">
import SpaceWorkspacePage from "$lib/features/space/SpaceWorkspacePage.svelte";

const props = $props<{
	data: {
		spaceId: string;
		view: "checkpoint-new";
		sessionId?: string | null;
		filePath?: string | null;
		checkpointId?: string | null;
	};
}>();
</script>

<SpaceWorkspacePage data={props.data} />
