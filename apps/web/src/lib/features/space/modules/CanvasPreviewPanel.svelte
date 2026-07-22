<script lang="ts">
import type { CanvasSemanticOp } from "@neta-art/cohub";
import { FolderOpen, Menu } from "lucide-svelte";
import type { CovasDocument } from "$lib/canvas/canvas-schema";
import PreviewExpandMenu from "$lib/components/PreviewExpandMenu.svelte";
import WorkspacePreviewPane from "$lib/components/WorkspacePreviewPane.svelte";
import { createLazyModuleLoader } from "$lib/lazy-module";
import { uiState } from "$lib/stores/ui.svelte";
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
	spaceId: string;
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
	spaceId,
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
	onClose: _onClose,
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

function openLeftSidebar() {
	uiState.mobileDrawerOpen = true;
}

function openRightSidebar() {
	uiState.mobileRightDrawerOpen = true;
}
</script>

{#snippet ExpandActions()}
	{#if !isMobile}
		<PreviewExpandMenu
			{focused}
			{immersive}
			size="sm"
			{onToggleFocus}
			{onToggleImmersive}
		/>
	{/if}
{/snippet}

{#snippet TabsChrome()}
	{#if isMobile}
		<div class="canvas-tabs-chrome canvas-tabs-chrome--mobile">
			<button
				type="button"
				class="icon-btn"
				title="Open sidebar"
				aria-label="Open sidebar"
				onclick={openLeftSidebar}
			>
				<Menu class="h-5 w-5" />
			</button>
			<div class="min-w-0 flex-1 overflow-hidden">
				<PreviewTabs
					tabs={previewTabs}
					onActivate={onActivatePreviewTab}
					onClose={onClosePreviewTab}
					embedded
				>
					{#snippet trailing()}
						{@render ExpandActions()}
					{/snippet}
				</PreviewTabs>
			</div>
			<button
				type="button"
				class="icon-btn"
				title="Open files"
				aria-label="Open files"
				onclick={openRightSidebar}
			>
				<FolderOpen class="h-5 w-5" />
			</button>
		</div>
	{:else}
		<PreviewTabs
			tabs={previewTabs}
			onActivate={onActivatePreviewTab}
			onClose={onClosePreviewTab}
			treeVisible={treeVisible}
			onToggleTree={immersive ? undefined : onToggleTree}
		>
			{#snippet trailing()}
				{@render ExpandActions()}
			{/snippet}
		</PreviewTabs>
	{/if}
{/snippet}

<WorkspacePreviewPane
	{width}
	ariaLabel={`Canvas ${canvas.path}`}
	{immersive}
	animate={animateShell}
	onResizeStart={onResizeStart}
>
	{#if canvas.loading}
		<div class="flex h-full min-w-0 flex-col bg-bg-primary">
			{@render TabsChrome()}
			<div class="flex flex-1 items-center justify-center text-xs text-text-tertiary">Loading…</div>
		</div>
	{:else if canvas.error}
		<div class="flex h-full min-w-0 flex-col bg-bg-primary">
			{@render TabsChrome()}
			<div class="m-4 rounded-lg border border-error-soft/30 bg-error-bg p-4 text-sm text-error-soft">{canvas.error}</div>
		</div>
	{:else if canvas.document}
		{#await canvasPanelModulePromise then canvasPanelModule}
			{@const LazyCanvasPanel = canvasPanelModule.default}
			<div class="relative flex h-full min-w-0 flex-col bg-bg-primary">
				{@render TabsChrome()}
				<div class="min-h-0 flex-1">
					<LazyCanvasPanel
						path={canvas.path}
						document={canvas.document}
						spaceId={spaceId}
						{immersive}
						onCommit={(document, ops) => onCommit(document, ops)}
						{onViewStateChange}
					/>
				</div>
			</div>
		{:catch}
			<div class="flex h-full min-w-0 flex-col bg-bg-primary">
				{@render TabsChrome()}
				<div class="m-4 flex flex-col items-start gap-2 rounded-lg border border-error-soft/30 bg-error-bg p-4 text-sm text-error-soft">
					<span>Canvas failed to load.</span>
					<button type="button" class="action-btn" onclick={() => { canvasPanelLoadAttempt += 1; }}>Retry</button>
				</div>
			</div>
		{/await}
	{:else}
		<div class="flex h-full min-w-0 flex-col bg-bg-primary">
			{@render TabsChrome()}
			<div class="m-4 rounded-lg border border-error-soft/30 bg-error-bg p-4 text-sm text-error-soft">Canvas data is unavailable.</div>
		</div>
	{/if}
</WorkspacePreviewPane>

<style>
	.canvas-tabs-chrome {
		display: flex;
		height: 2.5rem;
		flex-shrink: 0;
		align-items: stretch;
		border-bottom: 1px solid var(--border-subtle);
		background: var(--bg-surface);
	}

	.canvas-tabs-chrome--mobile {
		height: 2.75rem;
		align-items: center;
		gap: 0.125rem;
		padding: 0 0.25rem 0 0.125rem;
	}

	.canvas-tabs-chrome :global(.preview-tabs) {
		flex: 1 1 auto;
		border-bottom: 0;
		background: transparent;
	}
</style>
