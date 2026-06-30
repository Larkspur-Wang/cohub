<script lang="ts">
import type {
	MessageToolCallsFile,
	StoredIntermediateMessage,
} from "@cohub/protocol/model";
import ChatMessageBubble from "$lib/components/ChatMessageBubble.svelte";
import type { ModelCatalogItem } from "$lib/model-catalog";
import type { ChatMessage } from "$lib/session-tree";
import type { OpenWorkspaceFileTarget } from "$lib/workspace-file-links";

type Props = {
	message: StoredIntermediateMessage;
	streaming?: boolean;
	modelsCatalog?: ModelCatalogItem[];
	onLoadToolCalls?: () => Promise<MessageToolCallsFile | null>;
	onOpenFile?: (target: OpenWorkspaceFileTarget) => void;
};

const {
	message,
	streaming = false,
	modelsCatalog,
	onLoadToolCalls,
	onOpenFile,
}: Props = $props();
const chatMessage = $derived({
	id: message.id,
	sourceId: message.id,
	role: message.role,
	content: message.content,
	text: message.text ?? "",
	sequence: 0,
	blocks: [...message.content],
	createdAt: message.createdAt,
	meta: {
		messageKind: "assistant_intermediate",
		streaming,
		model: message.model,
		provider: message.provider,
		usage: message.usage,
		durationMs: message.durationMs,
		stopReason: message.stopReason,
		errorMessage: message.errorMessage,
	},
	toolCallsLoader: onLoadToolCalls,
} satisfies ChatMessage);
</script>

<div class="pl-5">
	<ChatMessageBubble message={chatMessage} {modelsCatalog} {onOpenFile} />
</div>
