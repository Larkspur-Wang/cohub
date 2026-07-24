<script lang="ts">
import type { CovasDocument } from "$lib/canvas/canvas-schema";
import {
	type CanvasRuntimeProps,
	type CanvasRuntimeViewState,
	resolveCanvasRuntime,
} from "$lib/canvas/runtime/canvas-runtime";
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
	isMobile: boolean;
	treeVisible?: boolean;
	onToggleTree?: () => void | Promise<void>;
	onToggleImmersive: () => void | Promise<void>;
	onCommit: CanvasRuntimeProps["onCommit"];
	onRetrySave: () => void | Promise<void>;
	onActivatePreviewTab: (kind: PreviewTab["kind"], key: string) => void;
	onClosePreviewTab: (kind: PreviewTab["kind"], key: string) => void;
	onViewStateChange?: (state: CanvasRuntimeViewState) => void;
};

let {
	canvas,
	previewTabs,
	spaceId,
	immersive,
	isMobile,
	treeVisible = true,
	onToggleTree,
	onToggleImmersive,
	onCommit,
	onRetrySave,
	onActivatePreviewTab,
	onClosePreviewTab,
	onViewStateChange,
}: Props = $props();

let canvasRuntimeLoadAttempt = $state(0);
const canvasRuntimeModulePromise = $derived.by(() => {
	canvasRuntimeLoadAttempt;
	if (!canvas.document) throw new Error("Canvas data is unavailable.");
	return resolveCanvasRuntime(canvas.document).load();
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
			filesVisible={treeVisible}
			onActivate={onActivatePreviewTab}
			onClose={onClosePreviewTab}
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
	{#await canvasRuntimeModulePromise then canvasRuntimeModule}
		{@const CanvasRuntime = canvasRuntimeModule.default}
		<div class="relative flex h-full min-w-0 flex-col bg-bg-primary">
			{@render TabsChrome()}
			<div class="min-h-0 flex-1">
				<CanvasRuntime
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
				<button type="button" class="action-btn" onclick={() => { canvasRuntimeLoadAttempt += 1; }}>Retry</button>
			</div>
		</div>
	{/await}
{:else}
	<div class="flex h-full min-w-0 flex-col bg-bg-primary">
		{@render TabsChrome()}
		<div class="m-4 rounded-lg border border-error-soft/30 bg-error-bg p-4 text-sm text-error-soft">Canvas data is unavailable.</div>
	</div>
{/if}
