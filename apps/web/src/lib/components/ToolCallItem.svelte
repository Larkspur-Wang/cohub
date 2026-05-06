<script lang="ts">
import { ChevronDown, ChevronRight, Loader2 } from "lucide-svelte";
import {
	formatToolInput,
	isSimpleInput,
	summarizeToolInput,
	type ToolCallViewModel,
} from "$lib/components/tool-call-format";

type Props = {
	tool: ToolCallViewModel;
	loading?: boolean;
	needsDetails?: boolean;
	onExpand?: () => void | Promise<void>;
};

const {
	tool,
	loading = false,
	needsDetails = false,
	onExpand,
}: Props = $props();
let expanded = $state(false);

const statusDotMap = {
	done: "bg-status-running",
	running: "bg-status-starting",
	failed: "bg-status-error",
} as const;

const inputDetail = $derived(formatToolInput(tool.input));
const showInputDetail = $derived(
	Boolean(inputDetail) && !isSimpleInput(tool.name, tool.input),
);
const hasResult = $derived(Boolean(tool.result));
const shouldWaitForDetails = $derived(expanded && loading && needsDetails);
const isPlaceholderResult = $derived(
	shouldWaitForDetails && (tool.result === "[]" || tool.result === ""),
);
const showResult = $derived(!needsDetails && hasResult && !isPlaceholderResult);
const resultLabel = $derived(tool.status === "failed" ? "err" : "out");
function toggle() {
	const opening = !expanded;
	expanded = opening;
	if (opening) void onExpand?.();
}
</script>

<div class="group rounded-md overflow-hidden">
	<button
		type="button"
		class="w-full flex items-center gap-2 pl-0 pr-1 py-0.5 text-left transition-colors hover:bg-bg-hover/50 cursor-pointer rounded-md"
		onclick={toggle}
	>
		<span class="inline-block w-1.5 h-1.5 rounded-full shrink-0 align-middle {statusDotMap[tool.status]} {tool.status === 'running' ? 'animate-pulse' : ''}"></span>
		<span class="text-[13px] font-mono text-text-tertiary shrink-0 w-[3em] truncate">{tool.name}</span>
		<span class="min-w-0 text-[13px] font-mono text-text-placeholder truncate">{summarizeToolInput(tool.name, tool.input)}</span>
		<span class="ml-auto text-text-tertiary shrink-0">
			{#if loading && expanded}
				<Loader2 class="w-3.5 h-3.5 animate-spin text-text-placeholder" />
			{:else if expanded}
				<ChevronDown class="w-3.5 h-3.5" />
			{:else}
				<ChevronRight class="w-3.5 h-3.5" />
			{/if}
		</span>
	</button>

	{#if expanded}
		<div class="pl-[26px] pr-2 py-0.5 space-y-0.5">
			{#if shouldWaitForDetails}
				<div class="inline-flex items-center gap-1.5 py-0.5 text-[12px] leading-snug text-text-placeholder">
					<Loader2 class="h-3 w-3 animate-spin" />
					Loading details…
				</div>
			{:else}
				{#if showInputDetail}
					<div class="grid grid-cols-[1.75rem_minmax(0,1fr)] gap-2 items-start">
						<div class="pt-[3px] font-mono text-[10px] leading-none uppercase tracking-wide text-text-placeholder select-none">in</div>
						<pre class="font-mono text-[13px] leading-snug text-text-secondary whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{inputDetail}</pre>
					</div>
				{/if}
				{#if showResult}
					<div class="grid grid-cols-[1.75rem_minmax(0,1fr)] gap-2 items-start">
						<div class="pt-[3px] font-mono text-[10px] leading-none uppercase tracking-wide select-none {tool.status === 'failed' ? 'text-status-error' : 'text-text-placeholder'}">{resultLabel}</div>
						<pre class="font-mono text-[13px] leading-snug whitespace-pre-wrap break-words [overflow-wrap:anywhere] {tool.status === 'failed' ? 'text-status-error' : 'text-text-secondary'}">{tool.result}</pre>
					</div>
				{:else if tool.resultOmitted}
					<div class="grid grid-cols-[1.75rem_minmax(0,1fr)] gap-2 items-start">
						<div class="pt-[3px] font-mono text-[10px] leading-none uppercase tracking-wide text-text-placeholder select-none">out</div>
						<div class="text-[12px] leading-snug text-text-placeholder">Result omitted. Open again after details load.</div>
					</div>
				{:else if tool.status === 'running'}
					<div class="grid grid-cols-[1.75rem_minmax(0,1fr)] gap-2 items-start">
						<div class="pt-[3px] font-mono text-[10px] leading-none uppercase tracking-wide text-text-placeholder select-none">out</div>
						<div class="text-[12px] leading-snug text-text-placeholder">Running…</div>
					</div>
				{/if}
			{/if}
		</div>
	{/if}
</div>
