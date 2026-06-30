<script lang="ts">
import type { ContentBlock } from "@cohub/protocol/core";
import type { MessageToolCallsFile } from "@cohub/protocol/model";
import ToolCallList from "$lib/components/ToolCallList.svelte";
import type { OpenWorkspaceFileTarget } from "$lib/workspace-file-links";

type Props = {
	content: ContentBlock[];
	toolCallsFile?: MessageToolCallsFile | null;
	onLoadToolCalls?: () => Promise<MessageToolCallsFile | null>;
	onOpenFile?: (target: OpenWorkspaceFileTarget) => void;
};

const {
	content,
	toolCallsFile = null,
	onLoadToolCalls,
	onOpenFile,
}: Props = $props();
</script>

<ToolCallList {content} {toolCallsFile} {onLoadToolCalls} {onOpenFile} />
