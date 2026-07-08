<script lang="ts">
import type { SpacePortStatus } from "@cohub/protocol/ports";
import PortPreview from "$lib/components/PortPreview.svelte";
import WorkspacePreviewPane from "$lib/components/WorkspacePreviewPane.svelte";
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
>
	<div class="flex h-full min-w-0 flex-col bg-bg-content">
		<PreviewTabs tabs={previewTabs} onActivate={onActivatePreviewTab} onClose={onClosePreviewTab} />
		<div class="min-h-0 flex-1">
			<PortPreview
				{port}
				{url}
				{status}
				{observedAt}
				{focused}
				{immersive}
				onToggleFocus={isMobile ? undefined : onToggleFocus}
				onToggleImmersive={isMobile ? undefined : onToggleImmersive}
				onPublish={onPublish}
				onClose={onClose}
			/>
		</div>
	</div>
</WorkspacePreviewPane>
