<script lang="ts">
import type { CanvasSemanticOp } from "@neta-art/cohub";
import { X } from "lucide-svelte";
import type { CovasDocument } from "$lib/canvas/canvas-schema";
import WorkspacePreviewPane from "$lib/components/WorkspacePreviewPane.svelte";

type InlineCanvasPanelState = {
	path: string;
	documentId: string | null;
	document: CovasDocument | null;
	loading: boolean;
	saving: boolean;
	error: string | null;
};

type Props = {
	canvas: InlineCanvasPanelState;
	width: number;
	focused: boolean;
	isMobile: boolean;
	onResizeStart: (event: PointerEvent) => void;
	onToggleFocus: () => void | Promise<void>;
	onCommit: (
		document: CovasDocument,
		ops: CanvasSemanticOp[],
	) => void | Promise<void>;
	onClose: () => void;
};

let {
	canvas,
	width,
	focused,
	isMobile,
	onResizeStart,
	onToggleFocus,
	onCommit,
	onClose,
}: Props = $props();
</script>

<WorkspacePreviewPane
	{width}
	ariaLabel={`Canvas ${canvas.path}`}
	onResizeStart={onResizeStart}
>
	{#if canvas.loading}
		<div class="flex h-full min-w-0 flex-col bg-bg-content">
			<div class="flex h-10 items-center border-b border-border-subtle px-3 text-xs text-text-tertiary">Loading canvas…</div>
			<div class="flex flex-1 items-center justify-center text-xs text-text-tertiary">Loading…</div>
		</div>
	{:else if canvas.error}
		<div class="flex h-full min-w-0 flex-col bg-bg-content">
			<div class="flex h-10 items-center gap-2 border-b border-border-subtle px-3">
				<span class="min-w-0 flex-1 truncate text-xs text-text-secondary">{canvas.path}</span>
				<button type="button" class="icon-btn" onclick={onClose} title="Close canvas"><X class="w-4 h-4" /></button>
			</div>
			<div class="m-4 rounded-lg border border-error-soft/30 bg-error-bg p-4 text-sm text-error-soft">{canvas.error}</div>
		</div>
	{:else if canvas.document}
		{#await import("$lib/components/canvas/CanvasPanel.svelte") then canvasPanelModule}
			{@const LazyCanvasPanel = canvasPanelModule.default}
			<LazyCanvasPanel
				path={canvas.path}
				document={canvas.document}
				saving={canvas.saving}
				focused={focused}
				onToggleFocus={isMobile ? undefined : onToggleFocus}
				onCommit={(document, ops) => onCommit(document, ops)}
				onClose={onClose}
			/>
		{:catch}
			<div class="flex h-full min-w-0 flex-col bg-bg-content">
				<div class="flex h-10 items-center gap-2 border-b border-border-subtle px-3">
					<span class="min-w-0 flex-1 truncate text-xs text-text-secondary">{canvas.path}</span>
					<button type="button" class="icon-btn" onclick={onClose} title="Close canvas"><X class="w-4 h-4" /></button>
				</div>
				<div class="m-4 rounded-lg border border-error-soft/30 bg-error-bg p-4 text-sm text-error-soft">Canvas failed to load.</div>
			</div>
		{/await}
	{:else}
		<div class="flex h-full min-w-0 flex-col bg-bg-content">
			<div class="flex h-10 items-center gap-2 border-b border-border-subtle px-3">
				<span class="min-w-0 flex-1 truncate text-xs text-text-secondary">{canvas.path}</span>
				<button type="button" class="icon-btn" onclick={onClose} title="Close canvas"><X class="w-4 h-4" /></button>
			</div>
			<div class="m-4 rounded-lg border border-error-soft/30 bg-error-bg p-4 text-sm text-error-soft">Canvas data is unavailable.</div>
		</div>
	{/if}
</WorkspacePreviewPane>
