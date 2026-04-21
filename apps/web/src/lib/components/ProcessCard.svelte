<script lang="ts">
import { ChevronDown, ChevronRight } from "lucide-svelte";
import ChatMessageBubble from "$lib/components/ChatMessageBubble.svelte";
import type { ChatMessage } from "$lib/session-tree";

type Props = {
	messages: ChatMessage[];
};

const { messages }: Props = $props();

let expanded = $state(false);

function toggle() {
	expanded = !expanded;
}

const toolCallCount = $derived(
	messages.reduce(
		(sum, msg) =>
			sum + (msg.content?.filter((b) => b.type === "tool_use").length ?? 0),
		0,
	),
);

const thinkingCharCount = $derived(
	messages.reduce((sum, msg) => {
		const thinking =
			msg.content
				?.filter((b) => b.type === "thinking")
				.map((b) => (b.type === "thinking" ? b.thinking : ""))
				.join("") ?? "";
		return sum + thinking.length;
	}, 0),
);

const labelParts = $derived(
	[
		messages.length > 0
			? `${messages.length} message${messages.length > 1 ? "s" : ""}`
			: "",
		toolCallCount > 0
			? `${toolCallCount} tool${toolCallCount > 1 ? "s" : ""}`
			: "",
		thinkingCharCount > 0 ? `${thinkingCharCount} chars thinking` : "",
	].filter(Boolean),
);

const summaryLabel = $derived(labelParts.join(" · "));
</script>

{#if !expanded}
	<button
		type="button"
		class="flex w-full items-center gap-2 px-4 py-2 text-left transition-colors hover:bg-bg-hover/50 cursor-pointer rounded-md"
		onclick={toggle}
	>
		<ChevronRight class="w-3.5 h-3.5 text-text-tertiary shrink-0" />
		<span class="text-[13px] text-text-tertiary">{summaryLabel}</span>
	</button>
{:else}
	<div class="flex flex-col gap-0">
		<button
			type="button"
			class="flex w-full items-center gap-2 px-4 py-2 text-left transition-colors hover:bg-bg-hover/50 cursor-pointer rounded-md"
			onclick={toggle}
		>
			<ChevronDown class="w-3.5 h-3.5 text-text-tertiary shrink-0" />
			<span class="text-[13px] text-text-tertiary">{summaryLabel}</span>
		</button>

		<div class="flex flex-col gap-2 pl-2 border-l border-border-subtle/40 ml-2">
			{#each messages as msg (msg.id)}
				<ChatMessageBubble message={msg} />
			{/each}
		</div>

		<button
			type="button"
			class="flex items-center gap-1.5 px-4 py-1.5 text-left transition-colors hover:bg-bg-hover/50 cursor-pointer text-text-placeholder hover:text-text-tertiary rounded-md self-start"
			onclick={toggle}
		>
			<ChevronRight class="w-3 h-3" />
			<span class="text-[11px]">Collapse</span>
		</button>
	</div>
{/if}
