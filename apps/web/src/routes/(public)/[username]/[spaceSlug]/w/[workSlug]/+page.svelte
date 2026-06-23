<script lang="ts">
import WorkSurface from "$lib/components/work/WorkSurface.svelte";

const props = $props<{
	data: {
		work: {
			id: string;
			spaceId: string;
			slug: string;
			targetType: "file" | "directory" | "port";
			targetRef: string;
			workScopes: string[];
			allowedViewerScopes: string[];
		};
		space?: {
			id: string;
			slug: string | null;
			name: string | null;
			userUuid: string;
			publicProfile?: { avatarUrl: string | null } | null;
		};
		owner: {
			username: string | null;
			displayName: string;
			avatarUrl?: string | null;
		} | null;
		content:
			| { url: string; targetType: "port"; port: string }
			| { url: string; targetType: "file" | "directory" | "port"; path: string }
			| null;
	};
}>();
</script>

<WorkSurface
	work={props.data.work}
	space={props.data.space}
	owner={props.data.owner}
	content={props.data.content}
/>
