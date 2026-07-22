<script lang="ts">
import type { CanvasSemanticOp } from "@neta-art/cohub";
import type { CovasDocument } from "$lib/canvas/canvas-schema";
import { createLazyModuleLoader } from "$lib/lazy-module";
import MobilePreviewTabsChrome from "./MobilePreviewTabsChrome.svelte";
import PreviewFloatChrome from "./PreviewFloatChrome.svelte";
import type { PreviewTab } from "./preview-tabs";

type InlineCanvasPanelState = {
	path: string;
	documentId: string | null;
	document: CovasDocument | null;
	loading: boolean;
	saving: boolean;
	error: string | null;
	saveError: string | null;
};

type Props = {
	canvas: InlineCanvasPanelState;
	previewTabs: PreviewTab[];
	spaceId: string;
	immersive: boolean;
	immersiveChatVisible: boolean;
	isMobile: boolean;
	treeVisible?: boolean;
	onToggleTree?: () => void | Promise<void>;
	onToggleImmersiveChat: () => void;
	onToggleImmersive: () => void | Promise<void>;
	onCommit: (
		document: CovasDocument,
		ops: CanvasSemanticOp[],
	) => void | Promise<void>;
	onRetrySave: () => void | Promise<void>;
	onActivatePreviewTab: (kind: PreviewTab["kind"], key: string) => void;
	onClosePreviewTab: (kind: PreviewTab["kind"], key: string) => void;
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
	spaceId,
	immersive,
	immersiveChatVisible,
	isMobile,
	treeVisible = true,
	onToggleTree,
	onToggleImmersiveChat,
	onToggleImmersive,
	onCommit,
	onRetrySave,
	onActivatePreviewTab,
	onClosePreviewTab,
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

{#snippet TabsChrome()}
	{#if isMobile}
		<MobilePreviewTabsChrome
			tabs={previewTabs}
			onActivate={onActivatePreviewTab}
			onClose={onClosePreviewTab}
		/>
	{:else if immersive}
		<PreviewFloatChrome
			tabs={previewTabs}
			chatVisible={immersiveChatVisible}
			filesVisible={treeVisible}
			onActivate={onActivatePreviewTab}
			onClose={onClosePreviewTab}
			onToggleChat={onToggleImmersiveChat}
			onToggleFiles={onToggleTree}
			onExit={onToggleImmersive}
		/>
	{/if}
{/snippet}

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
					syncError={canvas.saveError}
					onCommit={(document, ops) => onCommit(document, ops)}
					onRetrySync={onRetrySave}
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
