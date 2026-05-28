import type { TaskRunRecord } from "@neta-art/cohub";

type TaskRunPatch = Partial<TaskRunRecord> & {
	id: string;
	type?: string;
	userId?: string | null;
};

type TaskRunsCacheEvent = {
	spaceId: string;
	runs: TaskRunRecord[];
};

const runsBySpace = new Map<string, TaskRunRecord[]>();

const taskRunTime = (run: Pick<TaskRunRecord, "updatedAt" | "createdAt">) =>
	Date.parse(run.updatedAt ?? run.createdAt ?? "") || 0;

function sortRuns(runs: TaskRunRecord[]) {
	return [...runs].sort((a, b) => taskRunTime(b) - taskRunTime(a));
}

function normalizeTaskRunPatch(
	patch: TaskRunPatch,
	existing?: TaskRunRecord | null,
): TaskRunRecord {
	const now = new Date().toISOString();
	return {
		id: patch.id,
		jobId: patch.jobId ?? existing?.jobId ?? patch.id,
		cronJobId: patch.cronJobId ?? existing?.cronJobId ?? null,
		taskType: patch.taskType ?? patch.type ?? existing?.taskType ?? "unknown",
		status: patch.status ?? existing?.status ?? "pending",
		payload: patch.payload ?? existing?.payload ?? null,
		result: patch.result ?? existing?.result ?? null,
		errorMessage: patch.errorMessage ?? existing?.errorMessage ?? null,
		attemptCount: patch.attemptCount ?? existing?.attemptCount ?? 0,
		spaceId: patch.spaceId ?? existing?.spaceId ?? null,
		sessionId: patch.sessionId ?? existing?.sessionId ?? null,
		turnId: patch.turnId ?? existing?.turnId ?? null,
		userUuid: patch.userUuid ?? patch.userId ?? existing?.userUuid ?? null,
		scheduledAt: patch.scheduledAt ?? existing?.scheduledAt ?? null,
		startedAt: patch.startedAt ?? existing?.startedAt ?? null,
		finishedAt: patch.finishedAt ?? existing?.finishedAt ?? null,
		createdAt: patch.createdAt ?? existing?.createdAt ?? now,
		updatedAt: patch.updatedAt ?? existing?.updatedAt ?? now,
	};
}

function emit(spaceId: string, runs: TaskRunRecord[]) {
	if (typeof window === "undefined") return;
	window.dispatchEvent(
		new CustomEvent<TaskRunsCacheEvent>("cohub:task-runs-cache-updated", {
			detail: { spaceId, runs },
		}),
	);
}

export function setCachedTaskRuns(spaceId: string, runs: TaskRunRecord[]) {
	const nextRuns = sortRuns(runs);
	runsBySpace.set(spaceId, nextRuns);
	emit(spaceId, nextRuns);
	return nextRuns;
}

export function patchCachedTaskRuns(
	spaceId: string,
	updater: (runs: TaskRunRecord[]) => TaskRunRecord[],
) {
	const nextRuns = sortRuns(updater(runsBySpace.get(spaceId) ?? []));
	runsBySpace.set(spaceId, nextRuns);
	emit(spaceId, nextRuns);
	return nextRuns;
}

export function mergeCachedTaskRun(spaceId: string, patch: TaskRunPatch) {
	return patchCachedTaskRuns(spaceId, (runs) => {
		const existing = runs.find((run) => run.id === patch.id) ?? null;
		const nextRun = normalizeTaskRunPatch(patch, existing);
		if (!existing) return [nextRun, ...runs];
		return runs.map((run) => (run.id === patch.id ? nextRun : run));
	});
}

export function mergeCachedCronJobTaskRuns(
	spaceId: string,
	cronJobId: string,
	runs: TaskRunRecord[],
) {
	return patchCachedTaskRuns(spaceId, (currentRuns) => {
		const incomingIds = new Set(runs.map((run) => run.id));
		return [
			...runs,
			...currentRuns.filter(
				(run) => run.cronJobId !== cronJobId || !incomingIds.has(run.id),
			),
		];
	});
}

export function onTaskRunsCacheUpdated(
	handler: (event: TaskRunsCacheEvent) => void,
) {
	const listener = (event: Event) => {
		const custom = event as CustomEvent<TaskRunsCacheEvent>;
		if (!custom.detail?.spaceId) return;
		handler(custom.detail);
	};
	if (typeof window !== "undefined") {
		window.addEventListener("cohub:task-runs-cache-updated", listener);
	}
	return () => {
		if (typeof window !== "undefined") {
			window.removeEventListener("cohub:task-runs-cache-updated", listener);
		}
	};
}
