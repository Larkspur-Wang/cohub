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

<div class="max-w-[52rem]">
  <div class="overflow-hidden rounded-[1.25rem] border-[3px] border-black bg-white shadow-[4px_4px_0_0_#000]">
    <div class="flex items-center justify-between gap-3 border-b-[3px] border-black px-3 py-2 text-[10px] font-black uppercase tracking-[0.18em] text-black/60 bg-[#FFD93D]">
      <span>{tool.name}</span>
      <span class={`${tool.status === 'error' ? 'text-red-600' : tool.status === 'running' ? 'text-black' : 'text-black/60'}`}>
        {tool.status}
      </span>
    </div>

    {#if tool.args && Object.keys(tool.args).length > 0}
      <div class="border-b-[3px] border-black bg-[#FFF9F0] px-3 py-2">
        {#if tool.name === 'bash' && typeof tool.args.command === 'string'}
          <pre class="whitespace-pre-wrap break-words font-mono text-[11px] leading-5 text-black/70">$ {tool.args.command}</pre>
        {:else if ['read', 'write', 'edit'].includes(tool.name) && typeof tool.args.path === 'string'}
          <pre class="whitespace-pre-wrap break-words font-mono text-[11px] leading-5 text-black/70">{tool.args.path}</pre>
        {:else}
          <pre class="whitespace-pre-wrap break-words font-mono text-[11px] leading-5 text-black/70">{prettyArgs(tool.args)}</pre>
        {/if}
      </div>
    {/if}

    <pre class={`overflow-x-auto whitespace-pre-wrap break-words p-3 font-mono text-[11px] leading-5 ${isCodeTool ? 'bg-white text-black/80' : 'bg-[#FFF9F0] text-black/75'}`}>{tool.output}</pre>
  </div>
</div>
