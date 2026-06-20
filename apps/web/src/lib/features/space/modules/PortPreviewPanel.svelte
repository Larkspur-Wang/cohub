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
	isMobile: boolean;
	onResizeStart: (event: PointerEvent) => void;
	onToggleFocus: () => void | Promise<void>;
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
	isMobile,
	onResizeStart,
	onToggleFocus,
	onPublish,
	onClose,
}: Props = $props();
</script>

<WorkspacePreviewPane
	{width}
	ariaLabel={`Port ${port} preview`}
	onResizeStart={onResizeStart}
>
	<PortPreview
		{port}
		{url}
		{status}
		{observedAt}
		{focused}
		onToggleFocus={isMobile ? undefined : onToggleFocus}
		onPublish={onPublish}
		onClose={onClose}
	/>
</WorkspacePreviewPane>
