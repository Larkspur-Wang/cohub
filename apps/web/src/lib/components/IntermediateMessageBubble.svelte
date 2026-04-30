<script lang="ts">
import type {
	MessageToolCallsFile,
	StoredIntermediateMessage,
} from "@neta-art/cohub-protocol/model";
import ChatMessageBubble from "$lib/components/ChatMessageBubble.svelte";
import ToolCallList from "$lib/components/ToolCallList.svelte";
import type { ChatMessage } from "$lib/session-tree";

type ModelCatalogItem = {
	provider: string;
	id: string;
	model: Record<string, unknown>;
};

type Props = {
	message: StoredIntermediateMessage;
	modelsCatalog?: ModelCatalogItem[];
	onLoadToolCalls?: () => Promise<MessageToolCallsFile | null>;
};

const { message, modelsCatalog, onLoadToolCalls }: Props = $props();
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
		model: message.model,
		provider: message.provider,
		usage: message.usage,
		stopReason: message.stopReason,
		errorMessage: message.errorMessage,
	},
} satisfies ChatMessage);
</script>

<div>
	<ChatMessageBubble message={chatMessage} {modelsCatalog} />
	<ToolCallList content={message.content} {onLoadToolCalls} />
</div>
