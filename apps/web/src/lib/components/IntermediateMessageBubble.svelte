<script lang="ts">
import type {
	MessageToolCallsFile,
	StoredIntermediateMessage,
} from "@neta-art/cohub-protocol/model";
import ChatMessageBubble from "$lib/components/ChatMessageBubble.svelte";
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
	onOpenFile?: (path: string) => void;
};

const { message, modelsCatalog, onLoadToolCalls, onOpenFile }: Props = $props();
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
	toolCallsLoader: onLoadToolCalls,
} satisfies ChatMessage);
</script>

<div class="pl-5">
	<ChatMessageBubble message={chatMessage} {modelsCatalog} {onOpenFile} />
</div>
