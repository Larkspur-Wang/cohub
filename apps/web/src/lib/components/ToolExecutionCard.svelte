<script lang="ts">
import type { ToolState } from "$lib/session-tree";

type Props = {
  tool: ToolState;
};

const { tool }: Props = $props();

const prettyArgs = (args?: Record<string, unknown>) => {
  if (!args) {
    return "";
  }

  try {
    return JSON.stringify(args, null, 2);
  } catch {
    return String(args);
  }
};

const isCodeTool = $derived(
  ["bash", "read", "write", "edit", "grep", "find"].includes(tool.name),
);
</script>

<div class="max-w-[46rem]">
  <div class="overflow-hidden rounded-md border border-white/5 bg-[#131313]">
    <div class="flex items-center justify-between gap-3 border-b border-white/5 px-3 py-2 text-[10px] uppercase tracking-[0.22em] text-white/30">
      <span>{tool.name}</span>
      <span class={`${tool.status === 'error' ? 'text-red-300/76' : tool.status === 'running' ? 'text-amber-200/76' : 'text-white/30'}`}>
        {tool.status}
      </span>
    </div>

    {#if tool.args && Object.keys(tool.args).length > 0}
      <div class="border-b border-white/5 bg-white/[0.015] px-3 py-2">
        {#if tool.name === 'bash' && typeof tool.args.command === 'string'}
          <pre class="whitespace-pre-wrap break-words font-mono text-[11px] leading-5 text-white/62">$ {tool.args.command}</pre>
        {:else if ['read', 'write', 'edit'].includes(tool.name) && typeof tool.args.path === 'string'}
          <pre class="whitespace-pre-wrap break-words font-mono text-[11px] leading-5 text-white/62">{tool.args.path}</pre>
        {:else}
          <pre class="whitespace-pre-wrap break-words font-mono text-[11px] leading-5 text-white/62">{prettyArgs(tool.args)}</pre>
        {/if}
      </div>
    {/if}

    <pre class={`overflow-x-auto whitespace-pre-wrap break-words p-3 font-mono text-[11px] leading-5 ${isCodeTool ? 'bg-[#101010] text-white/74' : 'bg-[#141414] text-white/68'}`}>{tool.output}</pre>
  </div>
</div>
