import type { SpaceFsUploadDestination } from "@neta-art/cohub";
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
	destination?: SpaceFsUploadDestination;
	targetDir?: string;
	entries: LocalUploadEntry[];
	onProgress?: (progress: SpaceUploadProgress) => void;
};

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
		try {
			xhr.open("PUT", uploadUrl);
			for (const [key, value] of Object.entries(headers ?? {})) {
				// Skip empty / control-char values — Safari throws
				// "The string did not match the expected pattern."
				if (/[\r\n\0]/.test(value)) continue;
				xhr.setRequestHeader(key, value);
			}
		} catch (error) {
			reject(
				error instanceof Error
					? error
					: new Error("Upload failed: invalid request headers"),
			);
			return;
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

function normalizeDestination(input: {
	destination?: SpaceFsUploadDestination;
	targetDir?: string;
}): SpaceFsUploadDestination {
	if (input.destination) {
		if (input.destination.kind === "workspace") {
			return {
				kind: "workspace",
				targetDir: input.destination.targetDir
					? sanitizeRelativePath(input.destination.targetDir)
					: "",
			};
		}
		return input.destination;
	}
	return {
		kind: "workspace",
		targetDir: input.targetDir ? sanitizeRelativePath(input.targetDir) : "",
	};
}

export type MaterializeSpaceEntry = {
	name: string;
	relativePath: string;
	size: number;
	mimeType?: string | null;
	downloadUrl: string;
};

export type MaterializeSpaceEntriesOptions = {
	spaceId: string;
	destination?: SpaceFsUploadDestination;
	targetDir?: string;
	entries: MaterializeSpaceEntry[];
};

/**
 * Materialize already-uploaded durable public URLs into sandbox/workspace.
 * Uses the same createUpload/complete pipeline with entry.downloadUrl (no client PUT).
 */
export async function materializeSpaceEntries({
	spaceId,
	destination,
	targetDir = "",
	entries,
}: MaterializeSpaceEntriesOptions): Promise<SpaceUploadedFile[]> {
	if (entries.length === 0) return [];
	const uploadDestination = normalizeDestination({ destination, targetDir });
	const safeEntries = entries.map((entry) => ({
		...entry,
		relativePath: sanitizeRelativePath(entry.relativePath),
	}));
	const ids = safeEntries.map(() => crypto.randomUUID());
	const plan = await sdk.space(spaceId).files.createUpload({
		destination: uploadDestination,
		entries: safeEntries.map((entry, index) => ({
			id: ids[index],
			name: entry.name,
			relativePath: entry.relativePath,
			size: entry.size,
			mimeType: entry.mimeType ?? null,
			downloadUrl: entry.downloadUrl,
		})),
	});
	// Remote entries have no uploadUrl; complete immediately.
	const complete = await sdk
		.space(spaceId)
		.files.completeUpload(plan.uploadId, {
			entries: ids.map((id) => ({ id })),
		});
	return complete.uploaded.map((file) => ({
		path: file.path,
		name: file.name,
		size: file.size,
		mimeType: file.mimeType,
	}));
}

export async function uploadSpaceEntries({
	spaceId,
	destination,
	targetDir = "",
	entries,
	onProgress,
}: UploadSpaceEntriesOptions): Promise<SpaceUploadedFile[]> {
	if (entries.length === 0) return [];
	const uploadDestination = normalizeDestination({ destination, targetDir });
	const safeEntries = entries.map((entry) => ({
		...entry,
		relativePath: sanitizeRelativePath(entry.relativePath),
	}));
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
		destination: uploadDestination,
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
		if (!planned.uploadUrl) {
			// Remote downloadUrl entry — nothing to PUT.
			completedBytes += entry.file.size;
			onProgress?.({
				stage: "uploading",
				uploadedBytes: completedBytes,
				totalBytes,
				importedFiles: 0,
				totalFiles,
			});
			continue;
		}
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

	onProgress?.({
		stage: "done",
		uploadedBytes: totalBytes,
		totalBytes,
		importedFiles: totalFiles,
		totalFiles,
	});

	return complete.uploaded.map((file) => ({
		path: file.path,
		name: file.name,
		size: file.size,
		mimeType: file.mimeType,
	}));
}
