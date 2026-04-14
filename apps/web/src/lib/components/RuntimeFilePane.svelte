<script lang="ts">
import { renderMarkdown } from "$lib/markdown";
import type { RuntimeFsFileResponse } from "$lib/api";
import { FileWarning, Save, X } from "lucide-svelte";
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
  children,
}: {
  file: RuntimeFsFileResponse | null;
  draftContent: string;
  dirty: boolean;
  loading: boolean;
  saving: boolean;
  error: string | null;
  onInput: (value: string) => void;
  onSave: () => void;
  onClose: () => void;
  children?: import("svelte").Snippet;
} = $props();

let markdownHtml = $state("");

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

const dataUrl = $derived.by(() => {
  if (!file || file.kind !== "binary") return null;
  const mime = file.mimeType ?? "application/octet-stream";
  return `data:${mime};base64,${file.content}`;
});

const isImage = $derived(Boolean(file?.mimeType?.startsWith("image/")));
const isVideo = $derived(Boolean(file?.mimeType?.startsWith("video/")));
const isMarkdown = $derived(Boolean(file?.kind === "text" && /\.md$/i.test(file.path)));

const editorLanguage = $derived.by(() => {
  if (!file || file.kind !== "text") return "plaintext";
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  return ext;
});
</script>

<div class="flex h-full min-h-0 flex-col bg-bg-content">
  <div class="flex h-10 items-center gap-2 border-b border-border-subtle px-3 shrink-0">
    <div class="min-w-0 flex-1 truncate text-[12px] text-text-secondary">
      {file?.path ?? "Chat"}
    </div>
    {#if file?.kind === 'text'}
      <button
        type="button"
        class="action-btn"
        onclick={onSave}
        disabled={saving || !dirty}
        title="Save"
      >
        <Save class="w-3.5 h-3.5" />
        <span>Save</span>
      </button>
    {/if}
    {#if file}
      <button type="button" class="icon-btn" onclick={onClose} title="Close file">
        <X class="w-4 h-4" />
      </button>
    {/if}
  </div>

  <div class="min-h-0 flex-1 overflow-auto">
    {#if loading}
      <div class="flex h-full items-center justify-center text-[12px] text-text-tertiary">Loading file...</div>
    {:else if error}
      <div class="m-4 flex items-start gap-2 rounded-md border border-error-soft/30 bg-error-bg p-3 text-[12px] text-error-soft">
        <FileWarning class="mt-0.5 h-4 w-4 shrink-0" />
        <span>{error}</span>
      </div>
    {:else if !file}
      {@render children?.()}
    {:else if file.kind === 'text'}
      <div class="flex h-full min-h-0 flex-col">
        {#if isMarkdown && markdownHtml}
          <div class="grid min-h-0 flex-1 grid-cols-2 divide-x divide-border-subtle">
            <CodeEditor
              value={draftContent}
              language={editorLanguage}
              onInput={onInput}
            />
            <article class="preview prose prose-invert max-w-none p-4">{@html markdownHtml}</article>
          </div>
        {:else}
          <CodeEditor
            value={draftContent}
            language={editorLanguage}
            onInput={onInput}
          />
        {/if}
      </div>
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
        <div><strong>Type:</strong> {file.mimeType ?? 'application/octet-stream'}</div>
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
    width: 28px;
    height: 28px;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--text-tertiary);
  }
  .icon-btn:hover { background: var(--bg-hover); color: var(--text-secondary); }
  .action-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 28px;
    padding: 0 10px;
    border-radius: 6px;
    border: 1px solid var(--border-subtle);
    background: var(--bg-hover);
    color: var(--text-secondary);
    font-size: 12px;
  }
  .action-btn:disabled { opacity: 0.5; }
  .preview {
    overflow: auto;
  }
</style>
