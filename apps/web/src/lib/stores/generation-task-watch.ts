import { isTransientGenerationWatchError } from "$lib/board/generation-watch-policy";
import { canUseUserScopedCache, getCacheUserKey } from "$lib/cache/keys";
import { sdk } from "$lib/sdk";
import { mergeCachedTaskRun } from "$lib/stores/task-runs-cache";

const MAX_TRANSIENT_RETRIES = 4;
const RETRY_BASE_MS = 1_000;
const activeWatches = new Set<string>();

function sleep(ms: number) {
	return new Promise<void>((resolve) => window.setTimeout(resolve, ms));
}

async function runWatch(spaceId: string, taskRunId: string, userKey: string) {
	for (let retry = 0; ; retry += 1) {
		try {
			await sdk.generations.wait(taskRunId, {
				onPoll: ({ run }) => {
					const currentUserKey = getCacheUserKey();
					if (currentUserKey !== userKey) {
						console.warn(
							"[board-generation] task watch stopped: user changed",
							{
								spaceId,
								taskRunId,
							},
						);
						throw new Error("User identity changed during watch");
					}
					mergeCachedTaskRun(spaceId, run);
				},
			});
			return;
		} catch (error) {
			if (!isTransientGenerationWatchError(error)) return;
			if (retry >= MAX_TRANSIENT_RETRIES) {
				console.warn("[board-generation] task watch stopped after retries", {
					spaceId,
					taskRunId,
					error,
				});
				return;
			}
			await sleep(RETRY_BASE_MS * 2 ** retry);
		}
	}
}

export function watchGenerationTask(
	spaceId: string,
	taskRunId: string,
	userKey: string,
) {
	if (!canUseUserScopedCache(userKey)) return;
	const key = `${userKey}:${spaceId}:${taskRunId}`;
	if (activeWatches.has(key)) return;
	activeWatches.add(key);
	void runWatch(spaceId, taskRunId, userKey).finally(() =>
		activeWatches.delete(key),
	);
}
