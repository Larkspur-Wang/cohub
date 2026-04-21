<script lang="ts">
const _props = $props<{
	data: {
		spaceId: string;
		view: "space" | "session" | "file";
		sessionId?: string | null;
		filePath?: string | null;
	};
}>();
</script>

<SpaceWorkspacePage data={props.data} />
