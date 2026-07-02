<script lang="ts">
import type { SessionTurnRecord } from "@cohub/protocol/model";
import { Archive, ChevronDown, ChevronRight } from "lucide-svelte";
import MessageContentFlow from "$lib/components/MessageContentFlow.svelte";

type Props = {
	turn: SessionTurnRecord;
};

let { turn }: Props = $props();

let expanded = $state(false);

const compaction = $derived(
	(turn.meta?.compaction as Record<string, unknown> | undefined) ?? {},
);

const summary = $derived(
	turn.assistantContent?.[0]?.type === "system_note"
		? ((turn.assistantContent[0] as { text?: string }).text ?? "")
		: "",
);

const tokensBefore = $derived(compaction.tokensBefore as number | undefined);
const tokensAfter = $derived(compaction.tokensAfter as number | undefined);
const summarizedMessageCount = $derived(
	compaction.summarizedMessageCount as number | undefined,
);
const model = $derived(compaction.model as string | undefined);

function formatTokens(tokens: number): string {
	if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}K`;
	return String(tokens);
}
</script>

<div class="compact-divider">
	<div class="compact-header" role="button" tabindex="0" onclick={() => (expanded = !expanded)} onkeydown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); expanded = !expanded; } }>
		<Archive class="h-3.5 w-3.5 text-text-tertiary shrink-0" />
		<span class="compact-label">Context compacted</span>
		{#if tokensBefore != null && tokensAfter != null}
			<span class="compact-stats">
				{formatTokens(tokensBefore)} → {formatTokens(tokensAfter)} tokens
			</span>
		{/if}
		{#if summarizedMessageCount != null}
			<span class="compact-msgs">{summarizedMessageCount} msgs</span>
		{/if}
		{#if model}
			<span class="compact-model">{model}</span>
		{/if}
		{#if expanded}
			<ChevronDown class="h-3.5 w-3.5 text-text-tertiary shrink-0" />
		{:else}
			<ChevronRight class="h-3.5 w-3.5 text-text-tertiary shrink-0" />
		{/if}
	</div>
	{#if expanded && summary}
		<div class="compact-summary">
			<MessageContentFlow content={[{ type: "text", text: summary }]} thinkingExpanded={false} />
		</div>
	{/if}
</div>

<style>
	.compact-divider {
		display: flex;
		flex-direction: column;
		gap: 0;
		border-left: 2px solid var(--color-border-subtle, rgb(0 0 0 / 0.08));
		padding-left: 0.75rem;
	}

	.compact-header {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.375rem 0;
		cursor: pointer;
		user-select: none;
		font-size: 12px;
		color: var(--color-text-tertiary, rgb(0 0 0 / 0.4));
		transition: color 0.15s;
	}

	.compact-header:hover {
		color: var(--color-text-secondary, rgb(0 0 0 / 0.6));
	}

	.compact-label {
		font-weight: 500;
		letter-spacing: 0.01em;
	}

	.compact-stats,
	.compact-msgs,
	.compact-model {
		font-variant-numeric: tabular-nums;
		opacity: 0.7;
	}

	.compact-model {
		font-family: var(--font-mono, monospace);
		font-size: 11px;
	}

	.compact-summary {
		padding: 0.5rem 0 0.75rem;
		font-size: 13px;
		line-height: 1.6;
		color: var(--color-text-secondary, rgb(0 0 0 / 0.6));
		max-height: 24rem;
		overflow-y: auto;
		scrollbar-width: thin;
	}
</style>
