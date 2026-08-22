<script lang="ts">
import SpaceWorkspacePage from "$lib/features/space/SpaceWorkspacePage.svelte";

const props = $props<{
	data: {
		spaceId: string;
		view: "session";
		sessionId?: string | null;
		filePath?: string | null;
		windowKind?: "file" | "board" | "port" | "app" | null;
		windowKey?: string | null;
	};
}>();
</script>

<SpaceWorkspacePage data={props.data} />
