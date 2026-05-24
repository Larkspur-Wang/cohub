<script lang="ts">
import SpaceWorkspacePage from "$lib/features/space/SpaceWorkspacePage.svelte";

const props = $props<{
	data: {
		spaceId: string;
		view: "space" | "session" | "file";
		sessionId?: string | null;
		filePath?: string | null;
	};
}>();
</script>

<SpaceWorkspacePage data={props.data} />
