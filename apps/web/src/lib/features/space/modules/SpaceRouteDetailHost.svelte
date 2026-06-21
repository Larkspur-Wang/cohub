<script lang="ts">
import type {
	CronJobRecord,
	SpaceRecord,
	TaskRunRecord,
	WorkRecord,
} from "@neta-art/cohub";
import CheckpointView from "./CheckpointView.svelte";
import CronjobView from "./CronjobView.svelte";
import TaskRunView from "./TaskRunView.svelte";
import type { TaskRealtimeEvent } from "./task-run-detail-controller.svelte";
import { taskTypeLabel } from "./task-run-utils";
import WorkView from "./WorkView.svelte";

type RouteDetailHeaderMeta = {
	view: "checkpoint" | "cronjob" | "work" | "task";
	id: string;
	title: string;
} | null;

type Props = {
	routeView: string;
	spaceId: string;
	space: SpaceRecord | null;
	spaceLoadError: string;
	spaceHasMinimalAccess: boolean;
	routeCheckpointId: string | null;
	routeCronjobId: string | null;
	routeWorkId: string | null;
	routeTaskId: string | null;
	taskRealtimeEvent: TaskRealtimeEvent | null;
	ownerUsername: string | null;
	spaceSlug: string | null;
	onHeaderMeta: (meta: RouteDetailHeaderMeta) => void;
};

let {
	routeView,
	spaceId,
	space,
	spaceLoadError,
	spaceHasMinimalAccess,
	routeCheckpointId,
	routeCronjobId,
	routeWorkId,
	routeTaskId,
	taskRealtimeEvent,
	ownerUsername,
	spaceSlug,
	onHeaderMeta,
}: Props = $props();

const spaceName = $derived(space?.name ?? space?.title ?? spaceId);

function handleCheckpointLoaded(
	checkpoint: { description?: string | null } | null,
) {
	onHeaderMeta(
		checkpoint && routeCheckpointId
			? {
					view: "checkpoint",
					id: routeCheckpointId,
					title:
						checkpoint.description?.trim() ||
						`Save ${routeCheckpointId.slice(0, 8)}`,
				}
			: null,
	);
}

function handleCronjobLoaded(job: CronJobRecord | null) {
	onHeaderMeta(job ? { view: "cronjob", id: job.id, title: job.title } : null);
}

function handleWorkLoaded(work: WorkRecord | null) {
	onHeaderMeta(work ? { view: "work", id: work.id, title: work.slug } : null);
}

function handleTaskLoaded(run: TaskRunRecord | null) {
	onHeaderMeta(
		run
			? { view: "task", id: run.id, title: taskTypeLabel(run.taskType) }
			: null,
	);
}
</script>

{#if routeView === "checkpoint-new" || routeView === "checkpoint"}
	<CheckpointView
		mode={routeView === "checkpoint-new" ? "create" : "detail"}
		{spaceId}
		{space}
		{spaceLoadError}
		{spaceHasMinimalAccess}
		checkpointId={routeCheckpointId}
		onDetailLoaded={handleCheckpointLoaded}
	/>
{:else if routeView === "cronjob-new" || routeView === "cronjob"}
	<CronjobView
		mode={routeView === "cronjob-new" ? "create" : "detail"}
		{spaceId}
		{spaceName}
		{spaceLoadError}
		{spaceHasMinimalAccess}
		cronjobId={routeCronjobId}
		{taskRealtimeEvent}
		onDetailLoaded={handleCronjobLoaded}
	/>
{:else if routeView === "work"}
	<WorkView
		{spaceId}
		{routeWorkId}
		{ownerUsername}
		{spaceSlug}
		onDetailLoaded={handleWorkLoaded}
	/>
{:else if routeView === "task"}
	<TaskRunView
		{spaceId}
		taskId={routeTaskId}
		{taskRealtimeEvent}
		onDetailLoaded={handleTaskLoaded}
	/>
{/if}
