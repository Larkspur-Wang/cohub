<script lang="ts">
import type { ToolState } from "$lib/session-tree";

type Props = {
  tool: ToolState;
};

const { tool }: Props = $props();

const prettyArgs = (input?: Record<string, unknown>) => {
  if (!input) {
    return "";
  }

  try {
    return JSON.stringify(input, null, 2);
  } catch {
    return String(input);
  }
};

const isCodeTool = $derived(
  ["bash", "read", "write", "edit", "grep", "find"].includes(tool.name),
);

const toolInput = $derived(tool.input);
</script>

<div class="max-w-[52rem]">
  <div class="overflow-hidden rounded-md border border-border-primary bg-bg-elevated">
    <div class="flex items-center justify-between gap-3 border-b border-border-primary px-3 py-2 text-[10px] font-medium uppercase tracking-[0.18em] text-text-tertiary bg-bg-header-alt">
      <span>{tool.name}</span>
      <span class={`${tool.status === 'error' ? 'text-rose-400' : tool.status === 'running' ? 'text-amber-400' : 'text-text-tertiary'}`}>
        {tool.status}
      </span>
    </div>

    {#if toolInput && Object.keys(toolInput).length > 0}
      <div class="border-b border-border-primary bg-hover px-3 py-2">
        {#if tool.name === 'bash' && typeof toolInput.command === 'string'}
          <pre class="whitespace-pre-wrap break-words font-mono text-[11px] leading-5 text-text-secondary">$ {toolInput.command}</pre>
        {:else if ['read', 'write', 'edit'].includes(tool.name) && typeof toolInput.path === 'string'}
          <pre class="whitespace-pre-wrap break-words font-mono text-[11px] leading-5 text-text-secondary">{toolInput.path}</pre>
        {:else}
          <pre class="whitespace-pre-wrap break-words font-mono text-[11px] leading-5 text-text-secondary">{prettyArgs(toolInput)}</pre>
        {/if}
      </div>
    {/if}

    <pre class={`overflow-x-auto whitespace-pre-wrap break-words p-3 font-mono text-[11px] leading-5 ${isCodeTool ? 'bg-bg-elevated text-text-primary' : 'bg-bg-content text-text-secondary'}`}>{tool.output}</pre>
  </div>
</div>
