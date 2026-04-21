<script lang="ts">
const _props = $props<{
	data: {
		spaceId: string;
		view: "space" | "session" | "file" | "checkpoint" | "checkpoint-new";
		sessionId?: string | null;
		filePath?: string | null;
		checkpointId?: string | null;
	};
}>();
</script>

<SpaceWorkspacePage data={props.data} />

