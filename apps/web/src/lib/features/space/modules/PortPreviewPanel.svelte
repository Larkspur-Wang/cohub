<script lang="ts">
import type { SpacePortStatus } from "@cohub/protocol/ports";
import { FolderOpen, Menu } from "lucide-svelte";
import PortPreview from "$lib/components/PortPreview.svelte";
import PreviewExpandMenu from "$lib/components/PreviewExpandMenu.svelte";
import WorkspacePreviewPane from "$lib/components/WorkspacePreviewPane.svelte";
import { uiState } from "$lib/stores/ui.svelte";
import PreviewTabs from "./PreviewTabs.svelte";

type PreviewTab = {
	kind: "file" | "canvas" | "port";
	key: string;
	label: string;
	title: string;
	dirty?: boolean;
	active: boolean;
};

type Props = {
	previewTabs: PreviewTab[];
	port: string;
	url: string;
	status: SpacePortStatus | "unknown";
	observedAt?: number;
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
	onPublish: () => void;
	onActivatePreviewTab: (kind: PreviewTab["kind"], key: string) => void;
	onClosePreviewTab: (kind: PreviewTab["kind"], key: string) => void;
	onClose: () => void;
};

let {
	previewTabs,
	port,
	url,
	status,
	observedAt,
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
	onPublish,
	onActivatePreviewTab,
	onClosePreviewTab,
	onClose,
}: Props = $props();
</script>

<WorkspacePreviewPane
	{width}
	ariaLabel={`Port ${port} preview`}
	onResizeStart={onResizeStart}
	{immersive}
	animate={animateShell}
>
	<div class="flex h-full min-w-0 flex-col bg-bg-content" class:preview-stage--immersive={immersive}>
		{#if isMobile}
			<div class="flex h-11 shrink-0 items-center gap-0.5 border-b border-border-subtle bg-bg-surface px-1">
				<button type="button" class="icon-btn" title="Open sidebar" aria-label="Open sidebar" onclick={() => { uiState.mobileDrawerOpen = true; }}>
					<Menu class="h-5 w-5" />
				</button>
				<div class="min-w-0 flex-1 overflow-hidden">
					<PreviewTabs tabs={previewTabs} onActivate={onActivatePreviewTab} onClose={onClosePreviewTab} embedded />
				</div>
				<button type="button" class="icon-btn" title="Open files" aria-label="Open files" onclick={() => { uiState.mobileRightDrawerOpen = true; }}>
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
					<PreviewExpandMenu
						{focused}
						{immersive}
						size="sm"
						{onToggleFocus}
						{onToggleImmersive}
					/>
				{/snippet}
			</PreviewTabs>
		{/if}
		<div class="min-h-0 flex-1">
			<PortPreview
				{port}
				{url}
				{status}
				{observedAt}
				{immersive}
				onPublish={onPublish}
			/>
		</div>
	</div>
</WorkspacePreviewPane>
