<script lang="ts">
import type { SpacePortStatus } from "@cohub/protocol/ports";
import PortPreview from "$lib/components/PortPreview.svelte";
import WorkspacePreviewPane from "$lib/components/WorkspacePreviewPane.svelte";

type Props = {
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
	onClose: () => void;
};

let {
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
	onClose,
}: Props = $props();
</script>

<WorkspacePreviewPane
	{width}
	ariaLabel={`Port ${port} preview`}
	onResizeStart={onResizeStart}
	{immersive}
>
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
</WorkspacePreviewPane>
