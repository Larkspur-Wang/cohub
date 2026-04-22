import type { CheckpointRecord } from "@cohub/sdk";
import { sdk } from "$lib/sdk";

export async function pollCheckpointJob(taskRunId: string) {
	const startedAt = Date.now();
	while (Date.now() - startedAt < 90_000) {
		try {
			const { run } = await sdk.tasks.get(taskRunId);
			if (run.status === "completed") return run;
			if (run.status === "failed") {
				throw new Error(run.errorMessage || "Save job failed");
			}
		} catch (error) {
			if (!(error instanceof Error) || !error.message.includes("404")) {
				throw error;
			}
		}
		await new Promise((resolve) => setTimeout(resolve, 1500));
	}
	throw new Error("Save job timed out");
}

export function getCheckpointTitle(checkpoint: CheckpointRecord) {
	const normalized = checkpoint.description?.trim();
	return normalized && normalized.length > 0
		? normalized
		: `Save ${checkpoint.commitHash.slice(0, 12)}`;
}

export function formatCheckpointTimestamp(value: string) {
	return new Date(value).toLocaleString();
}
