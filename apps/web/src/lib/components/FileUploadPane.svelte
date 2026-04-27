<script lang="ts">
import { AlertCircle, Check, Upload, X } from "lucide-svelte";
import { sdk } from "$lib/sdk";

type UploadItem = {
	file: File;
	id: string;
	status: "pending" | "uploading" | "done" | "error";
	error?: string;
};

const {
	spaceId,
	targetDir = "",
	files = [],
	open = false,
	onClose,
	onComplete,
}: {
	spaceId: string;
	targetDir?: string;
	files?: File[];
	open?: boolean;
	onClose?: () => void;
	onComplete?: () => void;
} = $props();

let items = $state<UploadItem[]>([]);

let pending = $derived(items.filter((i) => i.status === "pending"));
let uploading = $derived(items.filter((i) => i.status === "uploading"));
let done = $derived(items.filter((i) => i.status === "done"));
let failed = $derived(items.filter((i) => i.status === "error"));
const totalCount = $derived(items.length);
const totalBytes = $derived(items.reduce((s, i) => s + i.file.size, 0));

function formatSize(bytes: number): string {
	if (bytes === 0) return "0 B";
	const units = ["B", "KB", "MB", "GB"];
	const i = Math.floor(Math.log(bytes) / Math.log(1024));
	const value = bytes / 1024 ** i;
	return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[i]}`;
}

let lastCount = $state(0);

function processNewFiles() {
	if (files.length === 0 || files.length === lastCount) return;
	lastCount = files.length;
	const newItems = files.map((f) => ({
		file: f,
		id: crypto.randomUUID(),
		status: "pending" as const,
	}));
	items = [...items, ...newItems];
	void processQueue();
}

// React to file changes
$effect(() => {
	void files.length;
	queueMicrotask(() => processNewFiles());
});

let processing = $state(false);

async function processQueue() {
	if (processing) return;
	processing = true;
	while (pending.length > 0 && uploading.length < 3) {
		const item = pending[0];
		item.status = "uploading";
		void uploadSingle(item);
	}
	processing = false;
}

async function uploadSingle(item: UploadItem) {
	try {
		await sdk.space(spaceId).files.upload([item.file], targetDir);
		item.status = "done";
	} catch {
		item.status = "error";
		item.error = "Upload failed";
	} finally {
		const remaining = items.filter(
			(i) => i.status === "pending" || i.status === "uploading",
		);
		if (remaining.length === 0 && done.length > 0) {
			onComplete?.();
			if (failed.length === 0) {
				setTimeout(() => {
					onClose?.();
					items = [];
					lastCount = 0;
				}, 2000);
			}
		}
		void processQueue();
	}
}

function handleDismiss() {
	onClose?.();
	items = [];
	lastCount = 0;
}
</script>

{#if open && items.length > 0}
  <div class="upload-pane">
    <div class="header">
      <span class="title">
        {#if uploading.length > 0 || pending.length > 0}
          Uploading files…
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
          <span class="name">{item.file.name}</span>
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
      {totalCount} file{totalCount !== 1 ? 's' : ''} · {formatSize(totalBytes)}
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
