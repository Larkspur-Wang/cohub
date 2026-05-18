import { sdk } from "$lib/sdk";
import {
	type LocalUploadEntry,
	sanitizeRelativePath,
} from "$lib/upload-entries";

export type SpaceUploadStage = "uploading" | "importing" | "done";

export type SpaceUploadProgress = {
	stage: SpaceUploadStage;
	uploadedBytes: number;
	totalBytes: number;
	importedFiles: number;
	totalFiles: number;
};

export type SpaceUploadedFile = {
	path: string;
	name: string;
	size: number;
	mimeType: string | null;
};

export type UploadSpaceEntriesOptions = {
	spaceId: string;
	targetDir?: string;
	entries: LocalUploadEntry[];
	onProgress?: (progress: SpaceUploadProgress) => void;
};

type ImportProgressData = {
	importedFiles?: number;
	phase?: string;
	errors?: Array<{ name?: string; message?: string }>;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function joinUploadPath(...parts: string[]) {
	return parts
		.flatMap((part) => part.split("/"))
		.map((part) => part.trim())
		.filter(Boolean)
		.join("/");
}

function putWithProgress(
	file: File,
	uploadUrl: string,
	headers: Record<string, string> | undefined,
	onProgress?: (uploaded: number) => void,
) {
	return new Promise<void>((resolve, reject) => {
		const xhr = new XMLHttpRequest();
		xhr.open("PUT", uploadUrl);
		for (const [key, value] of Object.entries(headers ?? {})) {
			xhr.setRequestHeader(key, value);
		}
		xhr.upload.onprogress = (event) => {
			if (!event.lengthComputable) return;
			onProgress?.(event.loaded);
		};
		xhr.onload = () => {
			if (xhr.status >= 200 && xhr.status < 300) resolve();
			else reject(new Error(`Upload failed (${xhr.status})`));
		};
		xhr.onerror = () => reject(new Error("Upload failed"));
		xhr.send(file);
	});
}

async function waitForImportTask(
	taskRunId: string,
	totalFiles: number,
	totalBytes: number,
	onProgress?: (progress: SpaceUploadProgress) => void,
) {
	let failures = 0;
	while (true) {
		let task: Awaited<ReturnType<typeof sdk.tasks.get>>;
		try {
			task = await sdk.tasks.get(taskRunId);
			failures = 0;
		} catch (error) {
			failures += 1;
			if (failures >= 5) throw error;
			await sleep(1200);
			continue;
		}

		const { run, progress } = task;
		const progressData =
			typeof progress === "object" && progress !== null
				? (progress as ImportProgressData)
				: null;
		const importedFiles = Number(progressData?.importedFiles ?? 0);
		onProgress?.({
			stage: "importing",
			uploadedBytes: totalBytes,
			totalBytes,
			importedFiles,
			totalFiles,
		});

		if (progressData?.phase === "failed" || run.status === "failed") {
			const message =
				progressData?.errors?.[0]?.message ??
				run.errorMessage ??
				"Import failed";
			throw new Error(message);
		}
		if (run.status === "completed") {
			onProgress?.({
				stage: "done",
				uploadedBytes: totalBytes,
				totalBytes,
				importedFiles: totalFiles,
				totalFiles,
			});
			return;
		}
		await sleep(1200);
	}
}

export async function uploadSpaceEntries({
	spaceId,
	targetDir = "",
	entries,
	onProgress,
}: UploadSpaceEntriesOptions): Promise<SpaceUploadedFile[]> {
	if (entries.length === 0) return [];
	const safeEntries = entries.map((entry) => ({
		...entry,
		relativePath: sanitizeRelativePath(entry.relativePath),
	}));
	const safeTargetDir = targetDir ? sanitizeRelativePath(targetDir) : "";
	const totalFiles = safeEntries.length;
	const totalBytes = safeEntries.reduce(
		(sum, entry) => sum + entry.file.size,
		0,
	);
	const ids = safeEntries.map(() => crypto.randomUUID());

	onProgress?.({
		stage: "uploading",
		uploadedBytes: 0,
		totalBytes,
		importedFiles: 0,
		totalFiles,
	});

	const plan = await sdk.space(spaceId).files.createUpload({
		targetDir: safeTargetDir,
		entries: safeEntries.map((entry, index) => ({
			id: ids[index],
			name: entry.file.name,
			relativePath: entry.relativePath,
			size: entry.file.size,
			mimeType: entry.file.type || null,
			lastModified: entry.file.lastModified,
		})),
	});
	const planById = new Map(plan.entries.map((entry) => [entry.id, entry]));
	let completedBytes = 0;

	for (const [index, entry] of safeEntries.entries()) {
		const id = ids[index];
		const planned = planById.get(id);
		if (!planned) throw new Error("Upload plan missing file");
		await putWithProgress(
			entry.file,
			planned.uploadUrl,
			planned.headers,
			(loaded) => {
				onProgress?.({
					stage: "uploading",
					uploadedBytes: Math.min(totalBytes, completedBytes + loaded),
					totalBytes,
					importedFiles: 0,
					totalFiles,
				});
			},
		);
		completedBytes += entry.file.size;
		onProgress?.({
			stage: "uploading",
			uploadedBytes: completedBytes,
			totalBytes,
			importedFiles: 0,
			totalFiles,
		});
	}

	onProgress?.({
		stage: "importing",
		uploadedBytes: totalBytes,
		totalBytes,
		importedFiles: 0,
		totalFiles,
	});
	const complete = await sdk
		.space(spaceId)
		.files.completeUpload(plan.uploadId, {
			entries: ids.map((id) => ({ id })),
		});
	await waitForImportTask(
		complete.taskRunId,
		totalFiles,
		totalBytes,
		onProgress,
	);

	return safeEntries.map((entry) => ({
		path: joinUploadPath(safeTargetDir, entry.relativePath),
		name: entry.relativePath.split("/").at(-1) ?? entry.file.name,
		size: entry.file.size,
		mimeType: entry.file.type || null,
	}));
}
