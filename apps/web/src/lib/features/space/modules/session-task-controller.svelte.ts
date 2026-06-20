import type { TaskRunRecord } from "@neta-art/cohub";

export const SESSION_TASK_TYPES = ["generation", "run_command"] as const;
export type SessionTaskType = (typeof SESSION_TASK_TYPES)[number];

export function isGenerationTaskRun(
	run: (Partial<TaskRunRecord> & { type?: string }) | null | undefined,
) {
	return (run?.taskType ?? run?.type) === "generation";
}

export function isBackgroundBashTaskRun(
	run: (Partial<TaskRunRecord> & { type?: string }) | null | undefined,
): run is TaskRunRecord {
	return (run?.taskType ?? run?.type) === "run_command" && !!run?.sessionId;
}

export function createSessionTaskController() {
	let generationTaskRunById = $state<Record<string, TaskRunRecord>>({});
	let backgroundBashTaskRunById = $state<Record<string, TaskRunRecord>>({});
	let backgroundBashHydrateKey = "";
	let recentHydrateKey = "";
	let recentLoading = $state(false);
	let recentCursors = $state<Partial<Record<SessionTaskType, string | null>>>(
		{},
	);
	let recentHasMoreByType = $state<Partial<Record<SessionTaskType, boolean>>>(
		{},
	);
	let pendingFollowupActionIds = $state<Set<string>>(new Set());

	function upsertGenerationTaskRun(run: TaskRunRecord) {
		if (!isGenerationTaskRun(run)) return;
		generationTaskRunById = { ...generationTaskRunById, [run.id]: run };
	}

	function upsertBackgroundBashTaskRun(run: TaskRunRecord) {
		if (!isBackgroundBashTaskRun(run)) return;
		backgroundBashTaskRunById = { ...backgroundBashTaskRunById, [run.id]: run };
	}

	function resetRecentPagination() {
		recentHydrateKey = "";
		recentCursors = {};
		recentHasMoreByType = {};
		recentLoading = false;
	}

	function setRecentPagination(
		hydrateKey: string,
		cursors: Partial<Record<SessionTaskType, string | null>>,
		hasMoreByType: Partial<Record<SessionTaskType, boolean>>,
	) {
		recentHydrateKey = hydrateKey;
		recentCursors = cursors;
		recentHasMoreByType = hasMoreByType;
	}

	function addPendingFollowupAction(turnId: string) {
		pendingFollowupActionIds = new Set([...pendingFollowupActionIds, turnId]);
	}

	function removePendingFollowupAction(turnId: string) {
		const next = new Set(pendingFollowupActionIds);
		next.delete(turnId);
		pendingFollowupActionIds = next;
	}

	function reset() {
		generationTaskRunById = {};
		backgroundBashTaskRunById = {};
		backgroundBashHydrateKey = "";
		pendingFollowupActionIds = new Set();
		resetRecentPagination();
	}

	return {
		get generationTaskRunById() {
			return generationTaskRunById;
		},
		get backgroundBashTaskRunById() {
			return backgroundBashTaskRunById;
		},
		get backgroundBashHydrateKey() {
			return backgroundBashHydrateKey;
		},
		set backgroundBashHydrateKey(value: string) {
			backgroundBashHydrateKey = value;
		},
		get recentHydrateKey() {
			return recentHydrateKey;
		},
		set recentHydrateKey(value: string) {
			recentHydrateKey = value;
		},
		get recentLoading() {
			return recentLoading;
		},
		set recentLoading(value: boolean) {
			recentLoading = value;
		},
		get recentCursors() {
			return recentCursors;
		},
		set recentCursors(value: Partial<Record<SessionTaskType, string | null>>) {
			recentCursors = value;
		},
		get recentHasMoreByType() {
			return recentHasMoreByType;
		},
		set recentHasMoreByType(value: Partial<Record<SessionTaskType, boolean>>) {
			recentHasMoreByType = value;
		},
		get pendingFollowupActionIds() {
			return pendingFollowupActionIds;
		},
		upsertGenerationTaskRun,
		upsertBackgroundBashTaskRun,
		resetRecentPagination,
		setRecentPagination,
		addPendingFollowupAction,
		removePendingFollowupAction,
		reset,
	};
}
