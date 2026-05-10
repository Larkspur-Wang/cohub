<script lang="ts">
import { ChevronDown, ChevronRight, Loader2 } from "lucide-svelte";
import { onDestroy, onMount } from "svelte";
import {
	formatToolInput,
	getToolFilePath,
	isSimpleInput,
	summarizeToolInput,
	type ToolCallViewModel,
} from "$lib/components/tool-call-format";

type Props = {
	tool: ToolCallViewModel;
	loading?: boolean;
	needsDetails?: boolean;
	onExpand?: () => void | Promise<void>;
	onOpenFile?: (path: string) => void;
};

const {
	tool,
	loading = false,
	needsDetails = false,
	onExpand,
	onOpenFile,
}: Props = $props();
let expanded = $state(false);
let reducedMotion = $state(false);
let activityText = $state("");
let visibleDraftingTail = $state("");
let inputTailSticky = $state(false);
let inputTailStickyTimer: number | null = null;
let previousDraftingLeaves = new Map<string, string>();
let activeDraftingLeafPath = $state<string | null>(null);

const statusDotMap = {
	done: "bg-status-running",
	running: "bg-brand shadow-[0_0_0_3px_rgba(255,62,0,0.10)]",
	failed: "bg-status-error",
} as const;

const toolActivityMap: Record<string, { glyph: string; verb: string }> = {
	bash: { glyph: "›", verb: "executing" },
	edit: { glyph: "±", verb: "patching" },
	find: { glyph: "⌕", verb: "scanning" },
	grep: { glyph: "⌕", verb: "scanning" },
	ls: { glyph: "◰", verb: "listing" },
	read: { glyph: "◰", verb: "reading" },
	write: { glyph: "▣", verb: "writing" },
};

const scrambleGlyphs = ["░", "▒", "_", "×", "·", "/", "|"];

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
const filePath = $derived(getToolFilePath(tool.name, tool.input));
const isRunning = $derived(tool.status === "running");
const runningPhase = $derived(tool.phase ?? "drafting");
const activity = $derived(
	toolActivityMap[tool.name] ?? { glyph: "◆", verb: "running" },
);
const draftingLeaves = $derived(flattenDraftingLeaves(tool.input));
const draftingTail = $derived(
	getDraftingTail(tool.name, tool.input, activeDraftingLeafPath),
);
const executionTail = $derived(
	getExecutionTail(tool.partialResult ?? tool.result),
);
const showDraftingTail = $derived(
	isRunning &&
		(runningPhase === "drafting" || (inputTailSticky && !executionTail)),
);

function toggle() {
	const opening = !expanded;
	expanded = opening;
	if (opening) void onExpand?.();
}
function handleFileClick(e: MouseEvent | KeyboardEvent) {
	e.stopPropagation();
	if (filePath) onOpenFile?.(filePath);
}

function stringifyInputPreview(input?: Record<string, unknown>): string {
	if (!input || Object.keys(input).length === 0) return "";
	try {
		return JSON.stringify(input);
	} catch {
		return String(input);
	}
}

function tailText(source: string, maxChars = 44) {
	const compact = source.replace(/\s+/g, " ").trim();
	if (!compact) return "";
	return compact.length > maxChars
		? `…${compact.slice(1 - maxChars)}`
		: compact;
}

type DraftingLeaf = {
	path: string;
	value: string;
};

function flattenDraftingLeaves(value: unknown, path = ""): DraftingLeaf[] {
	if (value == null) return [];
	if (["string", "number", "boolean"].includes(typeof value)) {
		const text = String(value).trim();
		return text ? [{ path, value: text }] : [];
	}
	if (Array.isArray(value)) {
		return value.flatMap((item, index) =>
			flattenDraftingLeaves(item, path ? `${path}.${index}` : String(index)),
		);
	}
	if (typeof value === "object") {
		return Object.entries(value as Record<string, unknown>).flatMap(
			([key, child]) =>
				flattenDraftingLeaves(child, path ? `${path}.${key}` : key),
		);
	}
	return [];
}

function leafKey(leaf: DraftingLeaf) {
	return leaf.path.split(".").at(-1)?.toLowerCase() ?? "";
}

function isPathLikeLeaf(leaf: DraftingLeaf) {
	const key = leafKey(leaf);
	return (
		key === "path" ||
		key.endsWith("path") ||
		key === "file" ||
		key === "filename"
	);
}

function isLowSignalConfigLeaf(leaf: DraftingLeaf) {
	return new Set([
		"timeout",
		"limit",
		"offset",
		"ignorecase",
		"glob",
		"context",
	]).has(leafKey(leaf));
}

function draftingLeafScore(leaf: DraftingLeaf) {
	const key = leafKey(leaf);
	if (
		["content", "newtext", "oldtext", "command", "query", "pattern"].includes(
			key,
		)
	)
		return 40;
	if (isPathLikeLeaf(leaf)) return 25;
	if (isLowSignalConfigLeaf(leaf)) return 5;
	return 20;
}

function formatDraftingLeaf(leaf: DraftingLeaf) {
	const key = leaf.path.split(".").at(-1) ?? "input";
	const tail = tailText(leaf.value);
	if (!tail) return "";
	return isPathLikeLeaf(leaf) ? tail : `${key}: ${tail}`;
}

function selectFallbackDraftingLeaf(leaves: DraftingLeaf[]) {
	return leaves.reduce<DraftingLeaf | null>((best, leaf) => {
		if (!best) return leaf;
		const score = draftingLeafScore(leaf);
		const bestScore = draftingLeafScore(best);
		return score > bestScore || score === bestScore ? leaf : best;
	}, null);
}

function getDraftingTail(
	name: string,
	input: Record<string, unknown> | undefined,
	activePath: string | null,
) {
	const leaves = flattenDraftingLeaves(input);
	const activeLeaf = activePath
		? leaves.find((leaf) => leaf.path === activePath)
		: null;
	const selected = activeLeaf ?? selectFallbackDraftingLeaf(leaves);
	if (selected)
		return formatDraftingLeaf(selected) || `${name || "tool"} forming`;
	const raw = stringifyInputPreview(input);
	const fallback = `${name || "tool"} forming`;
	return tailText(raw) || fallback;
}

function getExecutionTail(result?: string) {
	const source = result?.replace(/\s+/g, " ").trim() ?? "";
	if (!source) return "";
	return source.length > 58 ? `…${source.slice(-57)}` : source;
}

function scrambleWord(word: string, tick: number) {
	if (reducedMotion || tick % 7 === 0) return word;
	const chars = [...word];
	const mutable = chars
		.map((char, index) => ({ char, index }))
		.filter(
			({ char, index }) =>
				/[a-z]/i.test(char) && index > 1 && index < chars.length - 1,
		);
	if (mutable.length === 0) return word;
	const count = tick % 5 === 0 ? 2 : 1;
	for (let i = 0; i < count; i += 1) {
		const target = mutable[(tick * 3 + i * 5) % mutable.length];
		if (target)
			chars[target.index] =
				scrambleGlyphs[(tick + i * 2) % scrambleGlyphs.length];
	}
	return chars.join("");
}

$effect(() => {
	const current = new Map(
		draftingLeaves.map((leaf) => [leaf.path, leaf.value]),
	);
	const changed = draftingLeaves.filter(
		(leaf) => previousDraftingLeaves.get(leaf.path) !== leaf.value,
	);
	if (changed.length > 0) {
		const changedNonPath = changed.filter((leaf) => !isPathLikeLeaf(leaf));
		const selected =
			selectFallbackDraftingLeaf(changedNonPath) ??
			selectFallbackDraftingLeaf(changed) ??
			null;
		activeDraftingLeafPath = selected?.path ?? null;
	}
	previousDraftingLeaves = current;
});

$effect(() => {
	if (!isRunning) {
		visibleDraftingTail = draftingTail;
		inputTailSticky = false;
		if (inputTailStickyTimer) {
			window.clearTimeout(inputTailStickyTimer);
			inputTailStickyTimer = null;
		}
		return;
	}
	if (draftingTail && draftingTail !== visibleDraftingTail) {
		visibleDraftingTail = draftingTail;
		inputTailSticky = true;
		if (inputTailStickyTimer) window.clearTimeout(inputTailStickyTimer);
		inputTailStickyTimer = window.setTimeout(() => {
			inputTailSticky = false;
			inputTailStickyTimer = null;
		}, 850);
	}
});

$effect(() => {
	if (!isRunning || runningPhase !== "executing" || showDraftingTail) {
		activityText = activity.verb;
		return;
	}
	activityText = activity.verb;
	if (reducedMotion) return;
	let tick = 0;
	const interval = window.setInterval(() => {
		tick += 1;
		activityText = scrambleWord(activity.verb, tick);
	}, 150);
	return () => window.clearInterval(interval);
});

onMount(() => {
	const media = window.matchMedia("(prefers-reduced-motion: reduce)");
	const update = () => {
		reducedMotion = media.matches;
	};
	update();
	media.addEventListener("change", update);
	return () => media.removeEventListener("change", update);
});

onDestroy(() => {
	if (inputTailStickyTimer) window.clearTimeout(inputTailStickyTimer);
});
</script>

<div class="group rounded-md overflow-hidden">
	<button
		type="button"
		class={`relative w-full flex items-center gap-2 pl-0 pr-1 py-0.5 text-left transition-[background-color,color] duration-150 hover:bg-bg-hover/50 cursor-pointer rounded-md ${isRunning ? 'tool-call-running' : ''}`}
		onclick={toggle}
	>
		{#if isRunning}
			<span class="pointer-events-none absolute -left-1 top-1/2 h-4 w-px -translate-y-1/2 rounded-full bg-brand/70 tool-call-rail"></span>
		{/if}
		<span class="inline-block w-1.5 h-1.5 rounded-full shrink-0 align-middle transition-[background-color,box-shadow,opacity] duration-200 {statusDotMap[tool.status]} {isRunning ? 'tool-call-dot' : ''}"></span>
		<span class="text-[13px] font-mono text-text-tertiary shrink-0 w-[3em] truncate">{tool.name}</span>
		{#if filePath}
			<span
				role="link"
				tabindex="0"
				class="min-w-0 max-w-[48%] sm:max-w-[62%] text-[13px] font-mono text-text-secondary/85 truncate cursor-pointer transition-colors hover:text-text-primary hover:underline decoration-brand/35 underline-offset-2"
				onclick={handleFileClick}
				onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleFileClick(e); } }}
				title="Open file"
			>{filePath}</span>
			<span class="min-w-0 flex-1" aria-hidden="true"></span>
		{:else}
			<span class="min-w-0 flex-1 text-[13px] font-mono text-text-placeholder truncate">{summarizeToolInput(tool.name, tool.input)}</span>
		{/if}
		{#if isRunning}
			{#if showDraftingTail}
				<span class="tool-drafting-sliver shrink-0 max-w-[7rem] sm:max-w-[10rem] md:max-w-[12rem] text-[11px] font-mono leading-none text-brand/70" title={visibleDraftingTail}>
					<span class="tool-drafting-text">{visibleDraftingTail}</span><span class="tool-cursor" aria-hidden="true">▌</span>
				</span>
			{:else}
				<span class={`tool-executing-mark shrink-0 text-[11px] font-mono leading-none text-brand/75 ${tool.resultPartial && executionTail ? 'max-w-[8.5rem] sm:max-w-[13rem]' : 'max-w-[7.5rem] sm:max-w-[9rem]'}`} aria-label={tool.resultPartial && executionTail ? 'Latest output' : activity.verb} title={tool.resultPartial && executionTail ? executionTail : activity.verb}>
					<span class="tool-glyph" aria-hidden="true">{activity.glyph}</span>
					{#if tool.resultPartial && executionTail}
						<span class="tool-output-tail">{executionTail}</span><span class="tool-cursor" aria-hidden="true">▌</span>
					{:else}
						<span class="tool-activity-word">{activityText}</span><span class="tool-cursor" aria-hidden="true">▌</span>
					{/if}
				</span>
			{/if}
		{/if}
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
						<div class="text-[12px] leading-snug text-text-placeholder">{runningPhase === 'drafting' ? 'Receiving tool call…' : `${activity.verb[0].toUpperCase()}${activity.verb.slice(1)}…`}</div>
					</div>
				{/if}
			{/if}
		</div>
	{/if}
</div>

<style>
	.tool-call-running {
		isolation: isolate;
	}

	.tool-call-rail {
		animation: cohub-tool-rail-breathe 1.8s cubic-bezier(0.22, 1, 0.36, 1) infinite;
	}

	.tool-call-dot {
		animation: cohub-tool-dot-breathe 1.55s cubic-bezier(0.22, 1, 0.36, 1) infinite;
	}

	.tool-drafting-sliver,
	.tool-executing-mark {
		display: inline-flex;
		align-items: center;
		justify-content: flex-end;
		min-width: 0;
		overflow: hidden;
		white-space: nowrap;
		contain: content;
		mask-image: linear-gradient(90deg, transparent 0, #000 18px, #000 100%);
		-webkit-mask-image: linear-gradient(90deg, transparent 0, #000 18px, #000 100%);
	}

	.tool-drafting-text {
		min-width: 0;
		overflow: hidden;
		text-align: left;
		text-overflow: clip;
		direction: rtl;
		unicode-bidi: plaintext;
	}

	.tool-executing-mark {
		gap: 0.35rem;
	}

	.tool-glyph {
		font-size: 12px;
		line-height: 1;
		color: rgb(255 62 0 / 0.85);
		transform: translateY(-0.5px);
	}

	.tool-activity-word {
		min-width: 4.7rem;
		text-align: right;
		letter-spacing: 0.01em;
	}

	.tool-output-tail {
		min-width: 0;
		overflow: hidden;
		color: rgb(255 62 0 / 0.68);
		text-align: left;
		text-overflow: clip;
		direction: rtl;
		unicode-bidi: plaintext;
	}

	.tool-cursor {
		margin-left: 0.15rem;
		color: rgb(255 62 0 / 0.82);
		animation: cohub-tool-cursor 1.05s steps(2, jump-none) infinite;
	}

	@keyframes cohub-tool-cursor {
		0%, 46% { opacity: 1; }
		47%, 100% { opacity: 0.24; }
	}

	@keyframes cohub-tool-dot-breathe {
		0%, 100% { opacity: 0.72; transform: scale(0.92); }
		45% { opacity: 1; transform: scale(1.08); }
	}

	@keyframes cohub-tool-rail-breathe {
		0%, 100% { opacity: 0.48; transform: translateY(-50%) scaleY(0.72); }
		48% { opacity: 1; transform: translateY(-50%) scaleY(1); }
	}

	@media (max-width: 420px) {
		.tool-drafting-sliver {
			max-width: 4.8rem;
		}
		.tool-executing-mark {
			max-width: 5.8rem;
			gap: 0.25rem;
		}
		.tool-activity-word {
			min-width: 3.9rem;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.tool-call-rail,
		.tool-call-dot,
		.tool-cursor {
			animation: none;
		}
		.tool-cursor {
			opacity: 0.72;
		}
	}
</style>
