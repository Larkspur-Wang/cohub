<script lang="ts">
import { renderMarkdown } from "$lib/markdown";
import type { SpaceFsFileResponse } from "$lib/api";
import { Eye, FileWarning, Pencil, Save, X, Download } from "lucide-svelte";
import CodeEditor from "$lib/components/CodeEditor.svelte";

const {
  file,
  draftContent,
  dirty,
  loading,
  saving,
  error,
  onInput,
  onSave,
  onClose,
  onDownload,
  downloadUrl,
  children,
}: {
  file: SpaceFsFileResponse | null;
  draftContent: string;
  dirty: boolean;
  loading: boolean;
  saving: boolean;
  error: string | null;
  onInput: (value: string) => void;
  onSave: () => void;
  onClose: () => void;
  onDownload?: () => void;
  downloadUrl?: string;
  children?: import("svelte").Snippet;
} = $props();

let markdownHtml = $state("");
let fileEdit = $state(true);

$effect(() => {
  const current = file;
  if (!current || current.kind !== "text" || !/\.md$/i.test(current.path)) {
    markdownHtml = "";
    return;
  }
  void renderMarkdown(current.content).then((html) => {
    if (file?.path === current.path) markdownHtml = html;
  }).catch(() => {
    markdownHtml = "";
  });
});

$effect(() => {
  if (file) fileEdit = true;
});

const dataUrl = $derived.by(() => {
  if (!file || file.kind !== "binary") return null;
  const mime = file.mimeType ?? "application/octet-stream";
  return `data:${mime};base64,${file.content}`;
});
</script>

<div class="flex h-full min-w-0 flex-col bg-bg-content">
  <div class="flex items-center gap-2 border-b border-border-subtle px-3 py-2 shrink-0 min-w-0">
    <div class="min-w-0 flex-1">
      <div class="truncate text-[12px] font-medium text-text-primary">{file?.name ?? "No file selected"}</div>
      <div class="truncate text-[11px] text-text-tertiary">{file?.path ?? "Select a file from the sidebar"}</div>
    </div>

    {#if file}
      {#if file.kind === "text" && /\.md$/i.test(file.path)}
        <button type="button" class="icon-btn" onclick={() => fileEdit = !fileEdit} title={fileEdit ? "Preview" : "Edit"}>
          {#if fileEdit}
            <Eye class="w-3.5 h-3.5" />
          {:else}
            <Pencil class="w-3.5 h-3.5" />
          {/if}
        </button>
      {/if}

      {#if onDownload}
        <button type="button" class="icon-btn" onclick={onDownload} title="Download file">
          <Download class="w-3.5 h-3.5" />
        </button>
      {:else if downloadUrl}
        <a href={downloadUrl} class="icon-btn" title="Download file">
          <Download class="w-3.5 h-3.5" />
        </a>
      {/if}

      {#if file.kind === "text"}
        <button type="button" class="icon-btn" onclick={onSave} disabled={!dirty || saving} title="Save (Ctrl+S)">
          <Save class="w-3.5 h-3.5 {saving ? 'animate-pulse' : ''}" />
        </button>
      {/if}

      <button type="button" class="icon-btn" onclick={onClose} title="Close file">
        <X class="w-3.5 h-3.5" />
      </button>
    {/if}
  </div>

  {#if error}
    <div class="mx-3 mt-3 rounded-md border border-error-soft/30 bg-error-bg p-3 text-[12px] text-error-soft">{error}</div>
  {/if}

  <div class="min-h-0 flex-1 overflow-auto">
    {#if loading}
      <div class="flex h-full items-center justify-center text-[12px] text-text-tertiary">Loading file…</div>
    {:else if !file}
      <div class="flex h-full flex-col items-center justify-center gap-2 text-center text-text-tertiary px-6">
        <FileWarning class="w-5 h-5" />
        <div class="text-[13px]">Select a file to inspect or edit it.</div>
      </div>
    {:else if file.kind === "binary"}
      <div class="flex h-full items-center justify-center p-6">
        {#if dataUrl && file.mimeType?.startsWith("image/")}
          <img src={dataUrl} alt={file.name} class="max-h-full max-w-full rounded-md object-contain" />
        {:else}
          <div class="text-[12px] text-text-tertiary">Binary preview is not available.</div>
        {/if}
      </div>
    {:else if /\.md$/i.test(file.path) && !fileEdit}
      <article class="prose prose-invert max-w-none px-6 py-5 text-[14px]" >
        {@html markdownHtml}
      </article>
    {:else}
      <CodeEditor value={draftContent} language={file.path.split(".").pop()?.toLowerCase() ?? "plaintext"} onInput={onInput} />
    {/if}

    {@render children?.()}
  </div>
</div>
