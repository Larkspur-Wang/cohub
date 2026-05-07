<script lang="ts">
import { AlertCircle, Check, Upload, X } from "lucide-svelte";
import { sdk } from "$lib/sdk";
import type { LocalUploadEntry } from "$lib/upload-entries";

type UploadItem = {
	file: File;
	relativePath: string;
	id: string;
	status: "pending" | "uploading" | "importing" | "done" | "error";
	error?: string;
};

const {
	spaceId,
	targetDir = "",
	files = [],
	entries = [],
	open = false,
	onClose,
	onComplete,
}: {
	spaceId: string;
	targetDir?: string;
	files?: File[];
	entries?: LocalUploadEntry[];
	open?: boolean;
	onClose?: () => void;
	onComplete?: () => void;
} = $props();

let items = $state<UploadItem[]>([]);

let pending = $derived(items.filter((i) => i.status === "pending"));
let uploading = $derived(items.filter((i) => i.status === "uploading"));
let importing = $derived(items.filter((i) => i.status === "importing"));
let done = $derived(items.filter((i) => i.status === "done"));
let failed = $derived(items.filter((i) => i.status === "error"));
const totalCount = $derived(items.length);
const totalBytes = $derived(items.reduce((s, i) => s + i.file.size, 0));
let uploadedBytes = $state(0);
let taskRunId = $state<string | null>(null);
let stage = $state<"idle" | "uploading" | "importing" | "done" | "error">(
	"idle",
);

function formatSize(bytes: number): string {
	if (bytes === 0) return "0 B";
	const units = ["B", "KB", "MB", "GB"];
	const i = Math.floor(Math.log(bytes) / Math.log(1024));
	const value = bytes / 1024 ** i;
	return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[i]}`;
}

let lastSignature = $state("");

function effectiveEntries() {
	return entries.length > 0
		? entries
		: files.map((file) => ({ file, relativePath: file.name }));
}

function processNewFiles() {
	const uploadEntries = effectiveEntries();
	const signature = uploadEntries
		.map(
			(entry) =>
				`${entry.relativePath}:${entry.file.size}:${entry.file.lastModified}`,
		)
		.join("|");
	if (uploadEntries.length === 0 || signature === lastSignature) return;
	lastSignature = signature;
	items = uploadEntries.map((entry) => ({
		file: entry.file,
		relativePath: entry.relativePath,
		id: crypto.randomUUID(),
		status: "pending" as const,
	}));
	void uploadAll();
}

// React to file changes
$effect(() => {
	void files.length;
	void entries.length;
	queueMicrotask(() => processNewFiles());
});

async function putWithProgress(
	item: UploadItem,
	uploadUrl: string,
	headers?: Record<string, string>,
) {
	item.status = "uploading";
	await new Promise<void>((resolve, reject) => {
		const xhr = new XMLHttpRequest();
		xhr.open("PUT", uploadUrl);
		for (const [key, value] of Object.entries(headers ?? {}))
			xhr.setRequestHeader(key, value);
		xhr.upload.onprogress = (event) => {
			if (!event.lengthComputable) return;
			const otherDone = items
				.filter(
					(i) =>
						i !== item &&
						(i.status === "uploading" ||
							i.status === "importing" ||
							i.status === "done"),
				)
				.reduce((sum, i) => sum + i.file.size, 0);
			uploadedBytes = otherDone + event.loaded;
		};
		xhr.onload = () =>
			xhr.status >= 200 && xhr.status < 300
				? resolve()
				: reject(new Error(`Upload failed (${xhr.status})`));
		xhr.onerror = () => reject(new Error("Upload failed"));
		xhr.send(item.file);
	});
	uploadedBytes = items
		.filter((i) => i.status !== "pending")
		.reduce((sum, i) => sum + i.file.size, 0);
}

async function pollImportTask(id: string) {
	let failures = 0;
	while (true) {
		try {
			const { run, progress } = await sdk.tasks.get(id);
			failures = 0;
			const progressData =
				typeof progress === "object" && progress !== null
					? (progress as {
							importedFiles?: number;
							phase?: string;
							errors?: Array<{ name?: string; message?: string }>;
						})
					: null;
			const imported = Number(progressData?.importedFiles ?? 0);
			items = items.map((item, index) => ({
				...item,
				status: index < imported ? "done" : "importing",
			}));
			if (progressData?.phase === "failed" || run.status === "failed") {
				stage = "error";
				const errors = progressData?.errors ?? [];
				items = items.map((item) => {
					const error = errors.find(
						(e) =>
							e.name === item.relativePath ||
							e.name?.endsWith(`/${item.relativePath}`),
					);
					if (error)
						return {
							...item,
							status: "error",
							error: error.message ?? "Import failed",
						};
					return item.status === "done"
						? item
						: {
								...item,
								status: "error",
								error: run.errorMessage ?? "Import failed",
							};
				});
				return;
			}
			if (run.status === "completed") {
				items = items.map((item) => ({ ...item, status: "done" }));
				stage = "done";
				onComplete?.();
				setTimeout(() => {
					onClose?.();
					items = [];
					lastSignature = "";
					taskRunId = null;
				}, 1600);
				return;
			}
		} catch (error) {
			failures += 1;
			if (failures >= 5) {
				stage = "error";
				const message =
					error instanceof Error
						? error.message
						: "Unable to fetch import status";
				items = items.map((item) =>
					item.status === "done"
						? item
						: { ...item, status: "error", error: message },
				);
				return;
			}
		}
		await new Promise((resolve) => setTimeout(resolve, 1200));
	}
}

async function uploadAll() {
	try {
		stage = "uploading";
		const plan = await sdk.space(spaceId).files.createUpload({
			targetDir,
			entries: items.map((item) => ({
				id: item.id,
				name: item.file.name,
				relativePath: item.relativePath,
				size: item.file.size,
				mimeType: item.file.type || null,
				lastModified: item.file.lastModified,
			})),
		});
		const planById = new Map(plan.entries.map((entry) => [entry.id, entry]));
		for (const item of items) {
			const planned = planById.get(item.id);
			if (!planned) throw new Error("Upload plan missing file");
			await putWithProgress(item, planned.uploadUrl, planned.headers);
			item.status = "importing";
		}
		stage = "importing";
		const complete = await sdk
			.space(spaceId)
			.files.completeUpload(plan.uploadId, {
				entries: items.map((item) => ({ id: item.id })),
			});
		taskRunId = complete.taskRunId;
		void pollImportTask(complete.taskRunId);
	} catch (error) {
		stage = "error";
		const message = error instanceof Error ? error.message : "Upload failed";
		items = items.map((item) =>
			item.status === "done"
				? item
				: { ...item, status: "error", error: message },
		);
	}
}

function handleDismiss() {
	onClose?.();
	items = [];
	lastSignature = "";
	taskRunId = null;
	stage = "idle";
	uploadedBytes = 0;
}
</script>

{#if open && items.length > 0}
  <div class="upload-pane">
    <div class="header">
      <span class="title">
        {#if uploading.length > 0 || pending.length > 0}
          Uploading files…
        {:else if importing.length > 0 || stage === "importing"}
          Importing files…
        {:else if failed.length > 0}
          Upload complete · {failed.length} failed
        {:else}
          Upload complete
        {/if}
      </span>
      <button class="close-btn" type="button" onclick={handleDismiss} title="Close">
        <X class="w-3.5 h-3.5" />
      </button>
    </div>

    <div class="list">
      {#each items as item (item.id)}
        <div class="item" class:error={item.status === "error"}>
          <span class="name">{item.relativePath}</span>
          {#if item.status === "error"}
            <AlertCircle class="w-3.5 h-3.5 shrink-0 text-error-soft" />
          {:else if item.status === "done"}
            <Check class="w-3.5 h-3.5 shrink-0 text-success-soft" />
          {:else}
            <Upload class="w-3.5 h-3.5 shrink-0 animate-pulse text-text-tertiary" />
          {/if}
        </div>
      {/each}
    </div>

    <div class="footer">
      {totalCount} file{totalCount !== 1 ? 's' : ''} · {formatSize(stage === "uploading" ? uploadedBytes : totalBytes)} / {formatSize(totalBytes)}{#if taskRunId} · job {taskRunId.slice(0, 8)}{/if}
    </div>
  </div>
{/if}

<style>
  .upload-pane {
    position: absolute;
    bottom: 12px;
    right: 12px;
    width: 260px;
    max-height: 320px;
    background: var(--bg-primary);
    border: 1px solid var(--border-subtle);
    border-radius: 10px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15);
    z-index: 50;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 12px;
    border-bottom: 1px solid var(--border-subtle);
  }

  .title {
    font-size: 12px;
    font-weight: 500;
    color: var(--text-secondary);
  }

  .close-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border: none;
    border-radius: 5px;
    background: transparent;
    color: var(--text-tertiary);
    cursor: pointer;
  }

  .close-btn:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .list {
    flex: 1;
    overflow-y: auto;
    padding: 6px 8px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 5px 8px;
    border-radius: 6px;
    font-size: 12px;
    color: var(--text-secondary);
  }

  .item.error {
    color: var(--error-soft);
  }

  .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .footer {
    padding: 6px 12px;
    border-top: 1px solid var(--border-subtle);
    font-size: 11px;
    color: var(--text-tertiary);
  }
</style>
