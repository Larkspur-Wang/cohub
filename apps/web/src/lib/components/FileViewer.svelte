<script lang="ts">
const {
	filePath,
	fileContent,
	markdownHtml,
	isMarkdown,
	loading,
	error,
}: {
	filePath: string;
	fileContent: string;
	markdownHtml: string;
	isMarkdown: boolean;
	loading: boolean;
	error: string | null;
} = $props();
</script>

<section class="viewer">
  <header class="viewer-header">
    <span class="label">File</span>
    <strong>{filePath || "Select a file"}</strong>
  </header>

  <div class="viewer-body">
    {#if loading}
      <p class="hint">Loading file content...</p>
    {:else if error}
      <p class="error">{error}</p>
    {:else if !filePath}
      <p class="hint">Pick a file from the left tree.</p>
    {:else if isMarkdown}
      <article class="markdown">{@html markdownHtml}</article>
    {:else}
      <pre><code>{fileContent}</code></pre>
    {/if}
  </div>
</section>

<style>
  .viewer {
    height: 100%;
    border-left: 1px solid var(--border-subtle);
    border-right: 1px solid var(--border-subtle);
    background: var(--bg-surface);
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .viewer-header {
    height: 44px;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 12px;
    border-bottom: 1px solid var(--border-subtle);
    font-size: 13px;
  }

  .label {
    color: var(--text-tertiary);
  }

  .viewer-body {
    flex: 1;
    overflow: auto;
    padding: 14px;
  }

  pre {
    margin: 0;
    padding: 14px;
    background: var(--bg-code);
    border: 1px solid var(--border-subtle);
    border-radius: 8px;
    font-size: 13px;
    line-height: 1.5;
    overflow: auto;
  }

  .markdown {
    max-width: 920px;
    line-height: 1.7;
  }

  .markdown :global(h1),
  .markdown :global(h2),
  .markdown :global(h3) {
    margin-top: 1.2em;
    margin-bottom: 0.5em;
  }

  .markdown :global(code) {
    background: var(--bg-code);
    border: 1px solid var(--border-subtle);
    border-radius: 4px;
    padding: 0 4px;
  }

  .hint {
    color: var(--text-tertiary);
    font-size: 13px;
  }

  .error {
    color: var(--error);
    font-size: 13px;
  }
</style>
