import type { TaskRunRecord } from "@neta-art/cohub";
import {
	idbDeleteWhere,
	idbGet,
	idbGetAllByIndex,
	idbPut,
	type TaskRunDetailCacheRecord,
	type TaskRunSummaryCacheRecord,
} from "$lib/cache/db";
import { getCacheUserKey, taskRunKey } from "$lib/cache/keys";

const SUMMARY_LIMIT_PER_SPACE = 500;
const DETAIL_LIMIT_PER_SPACE = 100;
const SUMMARY_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const DETAIL_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function now() {
	return Date.now();
}

function sortRecords<T extends { updatedAt: number }>(records: T[]) {
	return [...records].sort((a, b) => b.updatedAt - a.updatedAt);
}

function toSummaryRecord(
	spaceId: string,
	run: TaskRunRecord,
): TaskRunSummaryCacheRecord {
	const userKey = getCacheUserKey();
	const timestamp = now();
	return {
		key: taskRunKey(userKey, spaceId, run.id),
		userKey,
		spaceId,
		sessionId: run.sessionId,
		turnId: run.turnId,
		taskRunId: run.id,
		taskType: run.taskType,
		status: run.status,
		run,
		updatedAt: Date.parse(run.updatedAt ?? "") || timestamp,
		lastAccessedAt: timestamp,
	};
}

function toDetailRecord(
	spaceId: string,
	run: TaskRunRecord,
	progress: unknown = null,
): TaskRunDetailCacheRecord {
	const userKey = getCacheUserKey();
	const timestamp = now();
	return {
		key: taskRunKey(userKey, spaceId, run.id),
		userKey,
		spaceId,
		sessionId: run.sessionId,
		turnId: run.turnId,
		taskRunId: run.id,
		taskType: run.taskType,
		run,
		progress,
		updatedAt: Date.parse(run.updatedAt ?? "") || timestamp,
		lastAccessedAt: timestamp,
	};
}

async function pruneStore<
	T extends {
		key: string;
		userKey: string;
		spaceId: string;
		updatedAt: number;
	},
>(
	store: "task_run_summaries" | "task_run_details",
	spaceId: string,
	limit: number,
	ttlMs: number,
) {
	const userKey = getCacheUserKey();
	const records = await idbGetAllByIndex<T>(
		store,
		"by_user_space",
		IDBKeyRange.only([userKey, spaceId]),
	);
	const cutoff = now() - ttlMs;
	const keep = new Set(
		sortRecords(records.filter((record) => record.updatedAt >= cutoff))
			.slice(0, limit)
			.map((record) => record.key),
	);
	await idbDeleteWhere<T>(
		store,
		(record) =>
			record.userKey === userKey &&
			record.spaceId === spaceId &&
			!keep.has(record.key),
	);
}

export async function readTaskRunSummaries(
	spaceId: string,
	sessionId?: string | null,
) {
	const userKey = getCacheUserKey();
	const records = sessionId
		? await idbGetAllByIndex<TaskRunSummaryCacheRecord>(
				"task_run_summaries",
				"by_user_space_session",
				IDBKeyRange.only([userKey, spaceId, sessionId]),
			)
		: await idbGetAllByIndex<TaskRunSummaryCacheRecord>(
				"task_run_summaries",
				"by_user_space",
				IDBKeyRange.only([userKey, spaceId]),
			);
	const cutoff = now() - SUMMARY_TTL_MS;
	return sortRecords(
		records.filter((record) => record.updatedAt >= cutoff),
	).map((record) => record.run);
}

export async function readTaskRunDetail(spaceId: string, taskRunId: string) {
	const userKey = getCacheUserKey();
	const record = await idbGet<TaskRunDetailCacheRecord>(
		"task_run_details",
		taskRunKey(userKey, spaceId, taskRunId),
	);
	if (!record || now() - record.updatedAt > DETAIL_TTL_MS) return null;
	return { run: record.run, progress: record.progress };
}

export async function writeTaskRunSummary(spaceId: string, run: TaskRunRecord) {
	await idbPut("task_run_summaries", toSummaryRecord(spaceId, run));
	void pruneStore<TaskRunSummaryCacheRecord>(
		"task_run_summaries",
		spaceId,
		SUMMARY_LIMIT_PER_SPACE,
		SUMMARY_TTL_MS,
	).catch(() => undefined);
}

export async function writeTaskRunSummaries(
	spaceId: string,
	runs: TaskRunRecord[],
) {
	await Promise.all(
		runs.map((run) =>
			idbPut("task_run_summaries", toSummaryRecord(spaceId, run)),
		),
	);
	void pruneStore<TaskRunSummaryCacheRecord>(
		"task_run_summaries",
		spaceId,
		SUMMARY_LIMIT_PER_SPACE,
		SUMMARY_TTL_MS,
	).catch(() => undefined);
}

export async function writeTaskRunDetail(
	spaceId: string,
	run: TaskRunRecord,
	progress: unknown = null,
) {
	await Promise.all([
		idbPut("task_run_summaries", toSummaryRecord(spaceId, run)),
		idbPut("task_run_details", toDetailRecord(spaceId, run, progress)),
	]);
	void pruneStore<TaskRunSummaryCacheRecord>(
		"task_run_summaries",
		spaceId,
		SUMMARY_LIMIT_PER_SPACE,
		SUMMARY_TTL_MS,
	).catch(() => undefined);
	void pruneStore<TaskRunDetailCacheRecord>(
		"task_run_details",
		spaceId,
		DETAIL_LIMIT_PER_SPACE,
		DETAIL_TTL_MS,
	).catch(() => undefined);
}
