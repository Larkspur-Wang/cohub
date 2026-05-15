<script lang="ts">
import type { ContentBlock } from "@cohub/protocol/core";
import type { MessageToolCallsFile } from "@cohub/protocol/model";
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
