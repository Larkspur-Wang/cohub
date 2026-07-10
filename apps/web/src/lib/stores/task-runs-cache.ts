import type { TaskRunRecord } from "@neta-art/cohub";
import { getCacheUserKeyAsync } from "$lib/cache/keys";
import {
	readTaskRunSummaries,
	writeTaskRunSummaries,
	writeTaskRunSummary,
} from "$lib/cache/repositories/task-runs-repo";

type TaskRunPatch = Partial<TaskRunRecord> & {
	id: string;
	type?: string;
	userId?: string | null;
};

type TaskRunsCacheEvent = {
	spaceId: string;
	runs: TaskRunRecord[];
};

const MAX_CACHED_RUNS = 500;
const runsBySpace = new Map<string, TaskRunRecord[]>();
const restoredSpaces = new Set<string>();

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

export function getCachedTaskRuns(spaceId: string) {
	return runsBySpace.get(spaceId) ?? [];
}

export async function restoreCachedTaskRuns(
	spaceId: string,
	sessionId?: string | null,
) {
	if (!sessionId && restoredSpaces.has(spaceId))
		return getCachedTaskRuns(spaceId);
	const restored = await readTaskRunSummaries(spaceId, sessionId);
	if (restored.length === 0) {
		if (!sessionId) restoredSpaces.add(spaceId);
		return getCachedTaskRuns(spaceId);
	}
	const nextRuns = patchCachedTaskRuns(
		spaceId,
		(current) => {
			const byId = new Map(current.map((run) => [run.id, run]));
			for (const run of restored)
				byId.set(run.id, { ...(byId.get(run.id) ?? run), ...run });
			return Array.from(byId.values());
		},
		{ persist: false },
	);
	if (!sessionId) restoredSpaces.add(spaceId);
	return nextRuns;
}

export function setCachedTaskRuns(spaceId: string, runs: TaskRunRecord[]) {
	const nextRuns = sortRuns(runs).slice(0, MAX_CACHED_RUNS);
	runsBySpace.set(spaceId, nextRuns);
	void (async () => {
		await getCacheUserKeyAsync();
		await writeTaskRunSummaries(spaceId, nextRuns);
	})().catch(() => undefined);
	emit(spaceId, nextRuns);
	return nextRuns;
}

export function patchCachedTaskRuns(
	spaceId: string,
	updater: (runs: TaskRunRecord[]) => TaskRunRecord[],
	options?: { persist?: boolean },
) {
	const nextRuns = sortRuns(updater(runsBySpace.get(spaceId) ?? [])).slice(
		0,
		MAX_CACHED_RUNS,
	);
	runsBySpace.set(spaceId, nextRuns);
	if (options?.persist !== false)
		void (async () => {
			await getCacheUserKeyAsync();
			await writeTaskRunSummaries(spaceId, nextRuns);
		})().catch(() => undefined);
	emit(spaceId, nextRuns);
	return nextRuns;
}

export function mergeCachedTaskRun(spaceId: string, patch: TaskRunPatch) {
	let merged: TaskRunRecord | null = null;
	const runs = patchCachedTaskRuns(spaceId, (currentRuns) => {
		const existing = currentRuns.find((run) => run.id === patch.id) ?? null;
		merged = normalizeTaskRunPatch(patch, existing);
		if (!existing) return [merged, ...currentRuns];
		return currentRuns.map((run) =>
			run.id === patch.id ? (merged as TaskRunRecord) : run,
		);
	});
	if (merged)
		void (async () => {
			await getCacheUserKeyAsync();
			await writeTaskRunSummary(spaceId, merged as TaskRunRecord);
		})().catch(() => undefined);
	return runs;
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
