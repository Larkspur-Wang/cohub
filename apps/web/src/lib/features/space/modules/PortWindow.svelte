<script lang="ts">
import type { SpacePortStatus } from "@cohub/protocol/ports";
import PortPreview from "$lib/components/PortPreview.svelte";
import MobileWindowTabsChrome from "./MobileWindowTabsChrome.svelte";

import type { Window } from "./windows";

type Props = {
	windows: Window[];
	port: string;
	url: string;
	status: SpacePortStatus | "unknown";
	observedAt?: number;
	immersive: boolean;
	isMobile: boolean;
	treeVisible?: boolean;
	onToggleTree?: () => void | Promise<void>;
	onToggleImmersive: () => void | Promise<void>;
	onPublish: () => void;
	onActivateWindow: (kind: Window["kind"], key: string) => void;
	onCloseWindow: (kind: Window["kind"], key: string) => void;
};

let {
	windows,
	port,
	url,
	status,
	observedAt,
	immersive,
	isMobile,
	treeVisible = true,
	onToggleTree,
	onToggleImmersive,
	onPublish,
	onActivateWindow,
	onCloseWindow,
}: Props = $props();
</script>

<div class="flex h-full min-w-0 flex-col bg-bg-content" class:preview-stage--immersive={immersive}>
	{#if isMobile}
		<MobileWindowTabsChrome
			tabs={windows}
			onActivate={onActivateWindow}
			onClose={onCloseWindow}
		/>
	{/if}
	<div class="min-h-0 flex-1">
		<PortPreview
			{port}
			{url}
			{status}
			{observedAt}
			{immersive}
			windows={windows}
			filesVisible={treeVisible}
			onActivateWindow={onActivateWindow}
			onCloseWindow={onCloseWindow}
			onToggleFiles={onToggleTree}
			onExitFloat={onToggleImmersive}
			onPublish={onPublish}
		/>
	</div>
</div>
