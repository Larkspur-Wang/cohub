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
const statusClass = $derived(
  tool.status === "running"
    ? "bg-slate-900 text-slate-100"
    : tool.status === "error"
      ? "bg-red-50 text-red-800"
      : "bg-slate-100 text-slate-800",
);
</script>

<div class="max-w-[95%]">
  <div class="rounded-2xl border overflow-hidden shadow-sm {tool.status === 'error' ? 'border-red-200' : 'border-slate-200'}">
    <div class="px-4 py-3 flex items-center justify-between gap-3 {statusClass}">
      <div>
        <div class="text-[10px] uppercase tracking-[0.2em] font-black opacity-70">Tool</div>
        <div class="font-bold mt-1">{tool.name}</div>
      </div>
      <div class="text-xs font-bold uppercase tracking-widest">
        {tool.status}
      </div>
    </div>

    {#if tool.args && Object.keys(tool.args).length > 0}
      <div class="px-4 py-3 border-t border-slate-200 bg-slate-50">
        <div class="text-[10px] uppercase tracking-[0.2em] font-black text-slate-500 mb-2">Arguments</div>

        {#if tool.name === 'bash' && typeof tool.args.command === 'string'}
          <pre class="text-xs leading-6 overflow-x-auto font-mono whitespace-pre-wrap break-words text-slate-800">$ {tool.args.command}</pre>
        {:else if ['read', 'write', 'edit'].includes(tool.name) && typeof tool.args.path === 'string'}
          <pre class="text-xs leading-6 overflow-x-auto font-mono whitespace-pre-wrap break-words text-slate-800">{tool.args.path}</pre>
        {:else}
          <pre class="text-xs leading-6 overflow-x-auto font-mono whitespace-pre-wrap break-words text-slate-800">{prettyArgs(tool.args)}</pre>
        {/if}
      </div>
    {/if}

    <div class="border-t border-slate-200">
      <div class="px-4 py-2 text-[10px] uppercase tracking-[0.2em] font-black text-slate-500 bg-white">Output</div>
      <pre class="p-4 text-xs leading-6 overflow-x-auto font-mono whitespace-pre-wrap break-words {isCodeTool ? 'bg-slate-950 text-slate-100' : 'bg-white text-slate-800'}">{tool.output}</pre>
    </div>
  </div>
</div>
