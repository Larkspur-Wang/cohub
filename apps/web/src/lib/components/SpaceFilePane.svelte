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

const isImage = $derived(Boolean(file?.mimeType?.startsWith("image/")));
const isVideo = $derived(Boolean(file?.mimeType?.startsWith("video/")));
const isText = $derived(Boolean(file?.kind === "text"));
const isMarkdown = $derived(Boolean(file?.kind === "text" && /\.md$/i.test(file.path)));

const editorLanguage = $derived.by(() => {
  if (!file || file.kind !== "text") return "plaintext";
  return file.name.split(".").pop()?.toLowerCase() ?? "";
});
</script>

<div class="flex h-full min-w-0 flex-col bg-bg-content">
  <!-- Toolbar -->
  <div class="flex h-10 items-center gap-1.5 sm:gap-2 border-b border-border-subtle px-2 sm:px-3 shrink-0">
    <div class="min-w-0 flex-1 truncate text-[11px] sm:text-[12px] text-text-secondary">
      {file?.path ?? "No file selected"}
    </div>

    {#if file && isMarkdown}
      <button
        type="button"
        class="toggle-btn"
        class:active={!fileEdit}
        onclick={() => fileEdit = false}
        title="Preview"
      >
        <Eye class="w-3.5 h-3.5" />
        <span class="hidden sm:inline">Preview</span>
      </button>
      <button
        type="button"
        class="toggle-btn"
        class:active={fileEdit}
        onclick={() => fileEdit = true}
        title="Edit"
      >
        <Pencil class="w-3.5 h-3.5" />
        <span class="hidden sm:inline">Edit</span>
      </button>
    {/if}

    {#if file && isText}
      <button
        type="button"
        class="action-btn"
        onclick={onSave}
        disabled={saving || !dirty}
        title="Save (Ctrl+S)"
      >
        <Save class="w-3.5 h-3.5 shrink-0" />
        <span class="hidden sm:inline">Save</span>
      </button>
    {/if}

    {#if file}
      {#if onDownload}
        <button type="button" class="icon-btn" onclick={onDownload} title="Download file">
          <Download class="w-4 h-4" />
        </button>
      {:else if downloadUrl}
        <a href={downloadUrl} class="icon-btn" title="Download file">
          <Download class="w-4 h-4" />
        </a>
      {/if}

      <button type="button" class="icon-btn" onclick={onClose} title="Close file">
        <X class="w-4 h-4" />
      </button>
    {/if}
  </div>

  {#if error}
    <div class="m-4 flex items-start gap-2 rounded-md border border-error-soft/30 bg-error-bg p-3 text-[12px] text-error-soft">
      <FileWarning class="mt-0.5 h-4 w-4 shrink-0" />
      <span>{error}</span>
    </div>
  {/if}

  <div class="min-h-0 flex-1 overflow-auto">
    {#if loading}
      <div class="flex h-full items-center justify-center text-[12px] text-text-tertiary">Loading file…</div>
    {:else if !file}
      {@render children?.()}
    {:else if isText}
      {#if isMarkdown && !fileEdit && markdownHtml}
        <article class="markdown-preview">{@html markdownHtml}</article>
      {:else}
        <CodeEditor
          value={draftContent}
          language={editorLanguage}
          onInput={onInput}
        />
      {/if}
    {:else if isImage && dataUrl}
      <div class="flex h-full items-center justify-center p-4">
        <img src={dataUrl} alt={file.name} class="max-h-full max-w-full rounded-md border border-border-subtle object-contain" />
      </div>
    {:else if isVideo && dataUrl}
      <div class="flex h-full items-center justify-center p-4">
        <video src={dataUrl} controls class="max-h-full max-w-full rounded-md border border-border-subtle">
          <track kind="captions" />
        </video>
      </div>
    {:else}
      <div class="m-4 rounded-md border border-border-subtle bg-bg-primary p-4 text-[12px] text-text-secondary">
        <div><strong>Name:</strong> {file.name}</div>
        <div><strong>Type:</strong> {file.mimeType ?? "application/octet-stream"}</div>
        <div><strong>Size:</strong> {file.size} bytes</div>
        <div class="mt-3 text-text-tertiary">This file type cannot be previewed in the browser.</div>
      </div>
    {/if}
  </div>
</div>

<style>
  .icon-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--text-tertiary);
    cursor: pointer;
  }
  .icon-btn:hover { background: var(--bg-hover); color: var(--text-secondary); }

  .action-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    min-height: 32px;
    padding: 0 10px;
    border-radius: 6px;
    border: 1px solid var(--border-subtle);
    background: var(--bg-hover);
    color: var(--text-secondary);
    font-size: 12px;
    cursor: pointer;
  }
  .action-btn:disabled { opacity: 0.5; cursor: not-allowed; }

  .toggle-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
    min-height: 28px;
    padding: 0 8px;
    border-radius: 6px;
    border: 1px solid transparent;
    background: transparent;
    color: var(--text-tertiary);
    font-size: 12px;
    cursor: pointer;
  }
  .toggle-btn:hover { background: var(--bg-hover); color: var(--text-secondary); }
  .toggle-btn.active {
    border-color: var(--border-subtle);
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .markdown-preview {
    height: 100%;
    overflow: auto;
    padding: 20px 24px;
    max-width: 860px;
    margin: 0 auto;
    line-height: 1.7;
    font-size: 14px;
  }
  .markdown-preview :global(h1) {
    font-size: 1.8em;
    font-weight: 700;
    margin-top: 0;
    margin-bottom: 0.5em;
    padding-bottom: 0.3em;
    border-bottom: 1px solid var(--border-subtle);
  }
  .markdown-preview :global(h2) {
    font-size: 1.4em;
    font-weight: 600;
    margin-top: 1.5em;
    margin-bottom: 0.5em;
  }
  .markdown-preview :global(h3) {
    font-size: 1.15em;
    font-weight: 600;
    margin-top: 1.2em;
    margin-bottom: 0.4em;
  }
  .markdown-preview :global(p) { margin-bottom: 1em; }
  .markdown-preview :global(code) {
    background: var(--bg-hover);
    border: 1px solid var(--border-subtle);
    border-radius: 4px;
    padding: 0.15em 0.4em;
    font-size: 0.9em;
    font-family: var(--font-mono, monospace);
  }
  .markdown-preview :global(pre) {
    background: var(--bg-primary);
    border: 1px solid var(--border-subtle);
    border-radius: 8px;
    padding: 16px;
    overflow: auto;
    margin-bottom: 1em;
  }
  .markdown-preview :global(pre code) {
    background: none;
    border: none;
    padding: 0;
    font-size: 13px;
    line-height: 1.5;
  }
  .markdown-preview :global(ul),
  .markdown-preview :global(ol) {
    padding-left: 1.5em;
    margin-bottom: 1em;
  }
  .markdown-preview :global(li) { margin-bottom: 0.3em; }
  .markdown-preview :global(blockquote) {
    border-left: 3px solid var(--border-subtle);
    padding-left: 1em;
    color: var(--text-tertiary);
    margin-bottom: 1em;
  }
  .markdown-preview :global(img) {
    max-width: 100%;
    border-radius: 6px;
    margin: 0.5em 0;
  }
  .markdown-preview :global(a) { color: var(--brand, #58a6ff); }
  .markdown-preview :global(table) {
    border-collapse: collapse;
    width: 100%;
    margin-bottom: 1em;
  }
  .markdown-preview :global(th),
  .markdown-preview :global(td) {
    border: 1px solid var(--border-subtle);
    padding: 8px 12px;
    text-align: left;
  }
  .markdown-preview :global(th) {
    background: var(--bg-hover);
    font-weight: 600;
  }
</style>
