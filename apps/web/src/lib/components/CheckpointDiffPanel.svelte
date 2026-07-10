<script lang="ts">
import type {
	CheckpointDiffFile,
	CheckpointDiffFileResponse,
	CheckpointDiffPatchLine,
	CheckpointDiffStats,
	CheckpointDiffStatus,
} from "@neta-art/cohub";
import { ChevronDown, ChevronRight, FileDiff, Loader2 } from "lucide-svelte";

type SummaryLike = {
	files: CheckpointDiffFile[];
	truncated: boolean;
	stats: CheckpointDiffStats;
	incomplete?: boolean;
};

type Props = {
	summary: SummaryLike | null;
	loading?: boolean;
	error?: string | null;
	emptyLabel?: string;
	/** When true, only show a compact summary row until the user expands. */
	collapsible?: boolean;
	/** Initial expanded state when collapsible. Default false. */
	defaultExpanded?: boolean;
	title?: string;
	/**
	 * Identity of the current diff range (e.g. headId + baseId).
	 * When this changes, expanded file patch caches are cleared.
	 */
	cacheKey?: string | null;
	/** Fires when a collapsible section is opened. */
	onExpand?: () => void;
	/** Load a single file patch on expand. Return null on failure. */
	loadFile: (path: string) => Promise<CheckpointDiffFileResponse | null>;
};

let {
	summary,
	loading = false,
	error = null,
	emptyLabel = "No changes",
	collapsible = false,
	defaultExpanded = false,
	title = "Changes",
	cacheKey = null,
	onExpand,
	loadFile,
}: Props = $props();

let sectionOpen = $state(false);
let expanded = $state<Record<string, boolean>>({});
let fileCache = $state<Record<string, CheckpointDiffFileResponse | null>>({});
let fileLoading = $state<Record<string, boolean>>({});
let fileError = $state<Record<string, string | null>>({});
let lastCacheKey = $state<string | null>(null);

$effect(() => {
	sectionOpen = collapsible ? defaultExpanded : true;
});

// Drop per-file patch cache when the compare range changes.
$effect(() => {
	const nextKey = cacheKey ?? null;
	if (lastCacheKey === nextKey) return;
	lastCacheKey = nextKey;
	expanded = {};
	fileCache = {};
	fileLoading = {};
	fileError = {};
});

function toggleSection() {
	const next = !sectionOpen;
	sectionOpen = next;
	if (next) onExpand?.();
}

function statusLabel(status: CheckpointDiffStatus): string {
	switch (status) {
		case "A":
			return "A";
		case "M":
		case "T":
			return "M";
		case "D":
			return "D";
		case "R":
			return "R";
		case "C":
			return "C";
		default:
			return status;
	}
}

function statusClass(status: CheckpointDiffStatus): string {
	switch (status) {
		case "A":
			return "text-success-soft";
		case "D":
			return "text-error-soft";
		case "R":
		case "C":
			return "text-brand";
		default:
			return "text-text-secondary";
	}
}

function formatCounts(file: CheckpointDiffFile): string {
	if (file.asset || file.binary) return "bin";
	const plus = file.additions;
	const minus = file.deletions;
	if (plus === null && minus === null) return "";
	const parts: string[] = [];
	if (typeof plus === "number") parts.push(`+${plus}`);
	if (typeof minus === "number") parts.push(`−${minus}`);
	return parts.join(" ");
}

function formatBytes(value: number | null | undefined): string {
	if (value === null || value === undefined) return "—";
	if (value < 1024) return `${value} B`;
	if (value < 1024 * 1024)
		return `${(value / 1024).toFixed(value >= 10 * 1024 ? 0 : 1)} KB`;
	return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function patchLineClass(type: CheckpointDiffPatchLine["type"]): string {
	if (type === "add") return "border-success/30 bg-success-bg/40 text-success";
	if (type === "del") return "border-error/30 bg-error-bg/40 text-error";
	if (type === "hunk")
		return "border-border-subtle bg-bg-elevated/50 text-text-tertiary";
	if (type === "meta") return "border-transparent text-text-placeholder";
	return "border-transparent text-text-secondary";
}

function patchLinePrefix(type: CheckpointDiffPatchLine["type"]): string {
	if (type === "add") return "+";
	if (type === "del") return "−";
	if (type === "hunk" || type === "meta") return "";
	return " ";
}

async function toggleFile(file: CheckpointDiffFile) {
	const key = file.path;
	const next = !expanded[key];
	expanded = { ...expanded, [key]: next };
	if (!next) return;
	if (key in fileCache || fileLoading[key]) return;
	if (file.asset || file.binary) {
		// Still load for size metadata when available.
	}
	fileLoading = { ...fileLoading, [key]: true };
	fileError = { ...fileError, [key]: null };
	try {
		const result = await loadFile(file.path);
		fileCache = { ...fileCache, [key]: result };
		if (!result) fileError = { ...fileError, [key]: "Failed to load diff" };
	} catch (err) {
		fileError = {
			...fileError,
			[key]: err instanceof Error ? err.message : "Failed to load diff",
		};
		fileCache = { ...fileCache, [key]: null };
	} finally {
		fileLoading = { ...fileLoading, [key]: false };
	}
}

function displayPath(file: CheckpointDiffFile): string {
	if (file.oldPath && file.oldPath !== file.path) {
		return `${file.oldPath} → ${file.path}`;
	}
	return file.path;
}

function statsLine(stats: CheckpointDiffStats): string {
	const parts: string[] = [];
	if (stats.changedFileCount > 0) {
		parts.push(
			`${stats.changedFileCount.toLocaleString("en-US")} file${stats.changedFileCount === 1 ? "" : "s"}`,
		);
	}
	if (stats.additions > 0)
		parts.push(`+${stats.additions.toLocaleString("en-US")}`);
	if (stats.deletions > 0)
		parts.push(`−${stats.deletions.toLocaleString("en-US")}`);
	return parts.join(" · ") || "No changes";
}
</script>

<div class="min-w-0">
	{#if collapsible}
		<button
			type="button"
			class="group flex w-full items-center gap-2 rounded-[6px] px-0 py-1.5 text-left transition-colors"
			onclick={toggleSection}
			aria-expanded={sectionOpen}
		>
			<span class="shrink-0 text-text-placeholder transition-colors group-hover:text-text-tertiary">
				{#if sectionOpen}
					<ChevronDown class="h-3.5 w-3.5" />
				{:else}
					<ChevronRight class="h-3.5 w-3.5" />
				{/if}
			</span>
			<span class="flex min-w-0 flex-1 items-center gap-2">
				<span class="text-[11px] font-medium uppercase tracking-wider text-text-placeholder">{title}</span>
				{#if loading && !summary}
					<span class="inline-flex items-center gap-1.5 text-[12px] text-text-tertiary">
						<Loader2 class="h-3 w-3 animate-spin" />
						Scanning…
					</span>
				{:else if summary}
					<span class="truncate font-mono text-[12px] tabular-nums text-text-tertiary">
						{statsLine(summary.stats)}
						{#if summary.incomplete}
							<span class="text-text-placeholder"> · partial</span>
						{/if}
					</span>
				{:else if error}
					<span class="truncate text-[12px] text-error-soft">Unavailable</span>
				{:else}
					<span class="text-[12px] text-text-placeholder">{emptyLabel}</span>
				{/if}
			</span>
			{#if !sectionOpen && summary && summary.stats.changedFileCount > 0}
				<span class="shrink-0 text-[11px] text-text-placeholder opacity-0 transition-opacity group-hover:opacity-100">
					Review
				</span>
			{/if}
		</button>
	{:else}
		<div class="mb-2 flex items-center gap-2 text-[11px] font-medium uppercase tracking-wider text-text-placeholder">
			<FileDiff class="h-3.5 w-3.5 shrink-0" />
			{title}
			{#if summary}
				<span class="font-mono normal-case tracking-normal text-text-tertiary">
					{statsLine(summary.stats)}
				</span>
			{/if}
		</div>
	{/if}

	{#if sectionOpen}
		<div class={collapsible ? "mt-1.5" : ""}>
			{#if loading && !summary}
				<div class="flex items-center gap-2 px-1 py-3 text-[12px] text-text-tertiary">
					<Loader2 class="h-3.5 w-3.5 animate-spin" />
					Loading changes…
				</div>
			{:else if error}
				<div class="rounded-[6px] border border-error-soft/25 bg-error-bg/30 px-3 py-2.5 text-[12px] text-error-soft">
					{error}
				</div>
			{:else if !summary || summary.files.length === 0}
				<div class="px-1 py-3 text-[12px] text-text-tertiary">
					{#if summary?.incomplete}
						Pending changes unavailable for this workspace
					{:else}
						{emptyLabel}
					{/if}
				</div>
			{:else}
				<div class="overflow-hidden rounded-[6px] border border-border-subtle/60">
					<ul class="divide-y divide-border-subtle/40">
						{#each summary.files as file (file.path)}
							{@const isOpen = Boolean(expanded[file.path])}
							{@const patch = fileCache[file.path]}
							{@const isFileLoading = Boolean(fileLoading[file.path])}
							{@const err = fileError[file.path]}
							<li class="min-w-0">
								<button
									type="button"
									class="flex w-full min-w-0 items-center gap-2 px-2.5 py-1.5 text-left transition-colors hover:bg-bg-hover/50"
									onclick={() => toggleFile(file)}
								>
									<span class="w-3 shrink-0 text-text-placeholder">
										{#if isOpen}
											<ChevronDown class="h-3 w-3" />
										{:else}
											<ChevronRight class="h-3 w-3" />
										{/if}
									</span>
									<span class={`w-3.5 shrink-0 text-center font-mono text-[11px] font-semibold ${statusClass(file.status)}`}>
										{statusLabel(file.status)}
									</span>
									<span
										class="min-w-0 flex-1 truncate font-mono text-[12px] text-text-secondary"
										title={displayPath(file)}
									>
										{displayPath(file)}
									</span>
									<span class="shrink-0 font-mono text-[11px] tabular-nums text-text-placeholder">
										{formatCounts(file)}
									</span>
								</button>

								{#if isOpen}
									<div class="border-t border-border-subtle/30 bg-bg-elevated/20">
										{#if isFileLoading}
											<div class="flex items-center gap-2 px-3 py-2.5 text-[12px] text-text-tertiary">
												<Loader2 class="h-3.5 w-3.5 animate-spin" />
												Loading…
											</div>
										{:else if err}
											<div class="px-3 py-2.5 text-[12px] text-error-soft">{err}</div>
										{:else if patch}
											{#if patch.kind === "asset"}
												<div class="px-3 py-2.5 text-[12px] text-text-tertiary">
													Binary asset
													<span class="font-mono text-text-secondary">
														({formatBytes(patch.oldSize)} → {formatBytes(patch.newSize)})
													</span>
												</div>
											{:else if patch.kind === "binary"}
												<div class="px-3 py-2.5 text-[12px] text-text-tertiary">
													Binary file
													<span class="font-mono text-text-secondary">
														({formatBytes(patch.oldSize)} → {formatBytes(patch.newSize)})
													</span>
												</div>
											{:else if patch.kind === "too_large"}
												<div class="px-3 py-2.5 text-[12px] text-text-tertiary">
													Diff too large to display
												</div>
											{:else if patch.lines.length === 0}
												<div class="px-3 py-2.5 text-[12px] text-text-tertiary">No textual changes</div>
											{:else}
												<div class="max-h-[min(42dvh,18rem)] overflow-auto overscroll-contain [scrollbar-width:thin]">
													{#each patch.lines as line, index (`${index}-${line.type}`)}
														{#if line.type !== "meta"}
															<div class={`grid grid-cols-[1rem_minmax(0,1fr)] gap-1 border-l px-2 py-px font-mono text-[11.5px] leading-snug ${patchLineClass(line.type)}`}>
																<span class="select-none opacity-80">{patchLinePrefix(line.type)}</span>
																<span class="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{line.text || " "}</span>
															</div>
														{/if}
													{/each}
													{#if patch.truncated}
														<div class="px-3 py-1.5 text-[11px] text-text-placeholder">… truncated</div>
													{/if}
												</div>
											{/if}
										{:else}
											<div class="px-3 py-2.5 text-[12px] text-text-tertiary">Unavailable</div>
										{/if}
									</div>
								{/if}
							</li>
						{/each}
					</ul>
					{#if summary.truncated || summary.incomplete}
						<div class="border-t border-border-subtle/40 px-2.5 py-1.5 text-[11px] text-text-placeholder">
							{#if summary.incomplete}
								Partial scan — not all files compared
							{:else}
								Showing first {summary.files.length} files
							{/if}
						</div>
					{/if}
				</div>
			{/if}
		</div>
	{/if}
</div>
