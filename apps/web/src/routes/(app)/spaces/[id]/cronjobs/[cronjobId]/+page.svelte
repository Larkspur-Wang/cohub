<script lang="ts">
import SpaceWorkspacePage from "$lib/features/space/SpaceWorkspacePage.svelte";

const props = $props<{
	data: {
		spaceId: string;
		view: "cronjob";
		sessionId?: string | null;
		filePath?: string | null;
		checkpointId?: string | null;
		cronjobId?: string | null;
		taskId?: string | null;
		windowKind?: "file" | "board" | "port" | "app" | null;
		windowKey?: string | null;
	};
}>();
</script>

<SpaceWorkspacePage data={props.data} />
