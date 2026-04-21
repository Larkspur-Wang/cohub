<script lang="ts">
import { ChevronDown, ChevronRight } from "lucide-svelte";
import type { ToolState } from "$lib/session-tree";

type Props = {
	tool: ToolState;
};

const { tool }: Props = $props();

let expanded = $state(false);

const statusDotMap = {
	done: "bg-status-running",
	running: "bg-status-starting animate-pulse",
	failed: "bg-status-error",
} as const;

function summarizeToolInput(
	name: string,
	input?: Record<string, unknown>,
): string {
	if (!input) return "";
	if (name === "bash" && typeof input.command === "string") {
		return `$ ${input.command}`;
	}
	if (
		["read", "write", "edit"].includes(name) &&
		typeof input.path === "string"
	) {
		return input.path;
	}
	try {
		return JSON.stringify(input);
	} catch {
		return String(input);
	}
}
</script>

<div class="group rounded-md overflow-hidden">
  <!-- Collapsed row — matches ChatMessageBubble inline tool style -->
  <button
    type="button"
    class="w-full flex items-center gap-2 pl-4 pr-4 py-0.5 text-left transition-colors hover:bg-bg-hover/50 cursor-pointer"
    onclick={() => (expanded = !expanded)}
  >
    <span class="inline-block w-1.5 h-1.5 rounded-full shrink-0 align-middle {statusDotMap[tool.status] ?? 'bg-text-placeholder'}"></span>
    <span class="text-[13px] font-mono text-text-tertiary shrink-0 w-[3em]">{tool.name}</span>
    <span class="min-w-0 text-[13px] font-mono text-text-placeholder truncate">{summarizeToolInput(tool.name, tool.input)}</span>
    <span class="ml-auto text-text-tertiary shrink-0">
      {#if expanded}
        <ChevronDown class="w-3.5 h-3.5" />
      {:else}
        <ChevronRight class="w-3.5 h-3.5" />
      {/if}
    </span>
  </button>

  {#if expanded}
    <div class="pl-[26px] pr-4">
      {#if tool.input && Object.keys(tool.input).length > 0}
        <div class="py-1.5">
          {#if tool.name === 'bash' && typeof tool.input.command === 'string'}
            <pre class="whitespace-pre-wrap break-words font-mono text-[13px] leading-relaxed text-text-secondary">$ {tool.input.command}</pre>
          {:else if ['read', 'write', 'edit'].includes(tool.name) && typeof tool.input.path === 'string'}
            <pre class="whitespace-pre-wrap break-words font-mono text-[13px] leading-relaxed text-text-secondary">{tool.input.path}</pre>
          {:else}
            <pre class="whitespace-pre-wrap break-words font-mono text-[13px] leading-relaxed text-text-secondary">{JSON.stringify(tool.input, null, 2)}</pre>
          {/if}
        </div>
      {/if}
      {#if tool.output}
        <pre class="p-2 font-mono text-[13px] leading-relaxed text-text-secondary whitespace-pre-wrap break-words [overflow-wrap:anywhere] bg-bg-code rounded-md">{tool.output}</pre>
      {/if}
    </div>
  {/if}
</div>
