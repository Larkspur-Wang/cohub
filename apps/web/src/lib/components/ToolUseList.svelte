<script lang="ts">
import type { ContentBlock } from "@neta-art/cohub-protocol/core";
import type { MessageToolCallsFile } from "@neta-art/cohub-protocol/model";
import ToolCallList from "$lib/components/ToolCallList.svelte";

type Props = {
	content: ContentBlock[];
	toolCallsFile?: MessageToolCallsFile | null;
	onLoadToolCalls?: () => Promise<MessageToolCallsFile | null>;
	onOpenFile?: (path: string) => void;
};

const {
	content,
	toolCallsFile = null,
	onLoadToolCalls,
	onOpenFile,
}: Props = $props();
</script>

<ToolCallList {content} {toolCallsFile} {onLoadToolCalls} {onOpenFile} />
