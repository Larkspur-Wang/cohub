<script lang="ts">
import type { CanvasSemanticOp } from "@neta-art/cohub";
import { X } from "lucide-svelte";
import type { CovasDocument } from "$lib/canvas/canvas-schema";
import WorkspacePreviewPane from "$lib/components/WorkspacePreviewPane.svelte";
import { createLazyModuleLoader } from "$lib/lazy-module";
import PreviewTabs from "./PreviewTabs.svelte";

type InlineCanvasPanelState = {
	path: string;
	documentId: string | null;
	document: CovasDocument | null;
	loading: boolean;
	saving: boolean;
	error: string | null;
};

type PreviewTab = {
	kind: "file" | "canvas" | "port";
	key: string;
	label: string;
	title: string;
	dirty?: boolean;
	active: boolean;
};

type Props = {
	canvas: InlineCanvasPanelState;
	previewTabs: PreviewTab[];
	width: number;
	focused: boolean;
	immersive: boolean;
	isMobile: boolean;
	animateShell?: boolean;
	treeVisible?: boolean;
	onToggleTree?: () => void;
	onResizeStart: (event: PointerEvent) => void;
	onToggleFocus: () => void | Promise<void>;
	onToggleImmersive: () => void | Promise<void>;
	onCommit: (
		document: CovasDocument,
		ops: CanvasSemanticOp[],
	) => void | Promise<void>;
	onActivatePreviewTab: (kind: PreviewTab["kind"], key: string) => void;
	onClosePreviewTab: (kind: PreviewTab["kind"], key: string) => void;
	onClose: () => void;
	onViewStateChange?: (state: {
		path: string;
		camera: CovasDocument["viewport"];
		visibleRect: {
			x: number;
			y: number;
			width: number;
			height: number;
		} | null;
		selectedNodes: Array<{ id: string; type: string; title?: string }>;
	}) => void;
};

let {
	canvas,
	previewTabs,
	width,
	focused,
	immersive,
	isMobile,
	animateShell = true,
	treeVisible = true,
	onToggleTree,
	onResizeStart,
	onToggleFocus,
	onToggleImmersive,
	onCommit,
	onActivatePreviewTab,
	onClosePreviewTab,
	onClose,
	onViewStateChange,
}: Props = $props();

const loadCanvasPanelModule = createLazyModuleLoader(
	() => import("$lib/components/canvas/CanvasPanel.svelte"),
);
let canvasPanelLoadAttempt = $state(0);
const canvasPanelModulePromise = $derived.by(() => {
	canvasPanelLoadAttempt;
	return loadCanvasPanelModule();
});
</script>

<WorkspacePreviewPane
	{width}
	ariaLabel={`Canvas ${canvas.path}`}
	{immersive}
	animate={animateShell}
	onResizeStart={onResizeStart}
>
	{#if canvas.loading}
		<div class="flex h-full min-w-0 flex-col bg-bg-content">
			{#if !immersive}
			<PreviewTabs tabs={previewTabs} onActivate={onActivatePreviewTab} onClose={onClosePreviewTab} treeVisible={treeVisible} onToggleTree={immersive ? undefined : onToggleTree} />
			{/if}
			<div class="flex h-11 shrink-0 items-center border-b border-border-subtle bg-bg-surface px-3 text-xs text-text-tertiary">Loading canvas…</div>
			<div class="flex flex-1 items-center justify-center text-xs text-text-tertiary">Loading…</div>
		</div>
	{:else if canvas.error}
		<div class="flex h-full min-w-0 flex-col bg-bg-content">
			{#if !immersive}
			<PreviewTabs tabs={previewTabs} onActivate={onActivatePreviewTab} onClose={onClosePreviewTab} treeVisible={treeVisible} onToggleTree={immersive ? undefined : onToggleTree} />
			{/if}
			<div class="flex h-11 shrink-0 items-center gap-2 border-b border-border-subtle bg-bg-surface px-3">
				<span class="min-w-0 flex-1 truncate text-xs text-text-secondary">{canvas.path}</span>
				<button type="button" class="icon-btn" onclick={onClose} title="Close canvas"><X class="w-4 h-4" /></button>
			</div>
			<div class="m-4 rounded-lg border border-error-soft/30 bg-error-bg p-4 text-sm text-error-soft">{canvas.error}</div>
		</div>
	{:else if canvas.document}
		{#await canvasPanelModulePromise then canvasPanelModule}
			{@const LazyCanvasPanel = canvasPanelModule.default}
			<div class="flex h-full min-w-0 flex-col bg-bg-content">
				{#if !immersive}
					<PreviewTabs tabs={previewTabs} onActivate={onActivatePreviewTab} onClose={onClosePreviewTab} treeVisible={treeVisible} onToggleTree={immersive ? undefined : onToggleTree} />
				{/if}
				<div class="min-h-0 flex-1">
					<LazyCanvasPanel
						path={canvas.path}
						document={canvas.document}
						saving={canvas.saving}
						focused={focused}
						{immersive}
						onToggleFocus={isMobile ? undefined : onToggleFocus}
						onToggleImmersive={isMobile ? undefined : onToggleImmersive}
						onCommit={(document, ops) => onCommit(document, ops)}
						onClose={onClose}
						{onViewStateChange}
					/>
				</div>
			</div>
		{:catch}
			<div class="flex h-full min-w-0 flex-col bg-bg-content">
				<div class="flex h-11 shrink-0 items-center gap-2 border-b border-border-subtle bg-bg-surface px-3">
					<span class="min-w-0 flex-1 truncate text-xs text-text-secondary">{canvas.path}</span>
					<button type="button" class="icon-btn" onclick={onClose} title="Close canvas"><X class="w-4 h-4" /></button>
				</div>
				<div class="m-4 flex flex-col items-start gap-2 rounded-lg border border-error-soft/30 bg-error-bg p-4 text-sm text-error-soft">
					<span>Canvas failed to load.</span>
					<button type="button" class="action-btn" onclick={() => { canvasPanelLoadAttempt += 1; }}>Retry</button>
				</div>
			</div>
		{/await}
	{:else}
		<div class="flex h-full min-w-0 flex-col bg-bg-content">
			{#if !immersive}
			<PreviewTabs tabs={previewTabs} onActivate={onActivatePreviewTab} onClose={onClosePreviewTab} treeVisible={treeVisible} onToggleTree={immersive ? undefined : onToggleTree} />
			{/if}
			<div class="flex h-11 shrink-0 items-center gap-2 border-b border-border-subtle bg-bg-surface px-3">
				<span class="min-w-0 flex-1 truncate text-xs text-text-secondary">{canvas.path}</span>
				<button type="button" class="icon-btn" onclick={onClose} title="Close canvas"><X class="w-4 h-4" /></button>
			</div>
			<div class="m-4 rounded-lg border border-error-soft/30 bg-error-bg p-4 text-sm text-error-soft">Canvas data is unavailable.</div>
		</div>
	{/if}
</WorkspacePreviewPane>
