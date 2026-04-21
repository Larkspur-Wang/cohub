<script lang="ts">
const _props = $props<{
	data: {
		spaceId: string;
		view: "cronjob-new";
		sessionId?: string | null;
		filePath?: string | null;
		checkpointId?: string | null;
		cronjobId?: string | null;
		taskId?: string | null;
	};
}>();
</script>

<SpaceWorkspacePage data={props.data} />
