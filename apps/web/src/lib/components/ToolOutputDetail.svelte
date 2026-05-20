<script lang="ts">
import {
	describeTextValue,
	isLongTextValue,
} from "$lib/components/tool-call-format";

type Props = {
	value: string;
	failed?: boolean;
	live?: boolean;
	partial?: boolean;
	idPrefix?: string;
};

const {
	value,
	failed = false,
	live = false,
	partial = false,
	idPrefix = "tool-output",
}: Props = $props();

let expanded = $state(false);

const summary = $derived(describeTextValue(value));
const collapsible = $derived(isLongTextValue(value));
const collapsed = $derived(collapsible && !expanded);
const bodyId = $derived(`${idPrefix}-${failed ? "err" : "out"}-body`);
</script>

<div class="min-w-0 space-y-1">
	{#if collapsible || partial || live}
		<div class="flex min-h-5 items-center gap-2 text-[11px] leading-none text-text-placeholder max-sm:gap-1.5">
			<span>{summary}</span>
			{#if partial || live}
				<span class="shrink-0 rounded-sm bg-brand-muted px-1 py-px font-mono text-[9px] uppercase tracking-wide text-brand-muted-fg">live</span>
			{/if}
		</div>
	{/if}

	<pre
		id={bodyId}
		class={`whitespace-pre-wrap break-words rounded-sm border-l border-border-subtle/70 bg-bg-code/40 py-1 pl-2 pr-1 font-mono text-[13px] leading-snug [overflow-wrap:anywhere] max-sm:text-[12px] ${failed ? 'text-status-error' : 'text-text-secondary'} ${collapsed ? 'max-h-56 overflow-hidden' : ''}`}
	>{value}</pre>

	{#if collapsible}
		<button
			type="button"
			class="inline-flex min-h-7 items-center rounded-sm px-0 text-[12px] leading-none text-text-placeholder transition-colors hover:text-text-secondary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand/35 sm:min-h-5 max-sm:min-h-11 max-sm:px-1"
			aria-expanded={expanded}
			aria-controls={bodyId}
			onclick={() => (expanded = !expanded)}
		>
			{expanded ? 'Collapse' : 'Show full'}
		</button>
	{/if}
</div>
