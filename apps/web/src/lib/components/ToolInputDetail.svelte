<script lang="ts">
import {
	formatToolInputView,
	type ToolInputSection,
} from "$lib/components/tool-call-format";

type Props = {
	name: string;
	input?: Record<string, unknown>;
	live?: boolean;
	idPrefix?: string;
};

const { name, input, live = false, idPrefix = "tool-input" }: Props = $props();

const view = $derived(formatToolInputView(name, input));
let expandedSections = $state<Record<string, boolean>>({});

function toggleSection(id: string) {
	expandedSections = { ...expandedSections, [id]: !expandedSections[id] };
}

function isExpanded(section: ToolInputSection) {
	return Boolean(expandedSections[section.id]);
}

function shouldCollapse(section: ToolInputSection) {
	return section.collapsible && !live && !isExpanded(section);
}

function sectionBodyId(section: ToolInputSection) {
	return `${idPrefix}-${section.id}-body`;
}
</script>

{#if view}
	<div class="min-w-0 space-y-1.5 pt-px">
		{#if view.primary}
			<div class="relative min-w-0">
				<pre class="whitespace-pre-wrap break-words font-mono text-[12px] leading-snug text-text-secondary [overflow-wrap:anywhere] max-sm:text-[12px]">{view.primary.value}</pre>
			</div>
		{/if}

		{#if view.fields.length > 0}
			<div class="space-y-0.5">
				{#each view.fields as field (field.label)}
					<div class="grid grid-cols-[minmax(4.5rem,max-content)_minmax(0,1fr)] items-baseline gap-x-2 gap-y-1 text-[12px] leading-snug max-sm:grid-cols-[minmax(3.5rem,max-content)_minmax(0,1fr)] max-sm:gap-x-1.5 max-sm:gap-y-0.5">
						<div class="font-mono text-[10px] uppercase tracking-wide text-text-placeholder select-none pt-[1px]">{field.label}</div>
						<div class={`min-w-0 break-words text-text-secondary [overflow-wrap:anywhere] ${field.mono ? 'font-mono text-[13px] max-sm:text-[12px]' : ''}`}>{field.value}</div>
					</div>
				{/each}
			</div>
		{/if}

		{#if view.sections.length > 0}
			<div class="space-y-2 pt-0.5">
				{#each view.sections as section (section.id)}
					<div class="min-w-0 space-y-1">
						<div class="flex min-h-5 items-start gap-2 text-[11px] leading-none max-sm:gap-1.5">
							<div class="font-mono uppercase tracking-wide text-text-placeholder select-none pt-[1px]">{section.label}</div>
							{#if section.summary}
								<div class="truncate text-text-placeholder">{section.summary}</div>
							{/if}
							{#if live && section.collapsible}
								<div class="shrink-0 rounded-sm bg-brand-muted px-1 py-px font-mono text-[9px] uppercase tracking-wide text-brand-muted-fg">live</div>
							{/if}
						</div>

						{#if section.kind === 'diff'}
							<div class="relative min-w-0">
								<div
									id={sectionBodyId(section)}
									class={`overflow-hidden ${shouldCollapse(section) ? 'max-h-56' : ''}`}
								>
									{#each section.lines ?? [] as line, index (`${index}-${line.sign}`)}
										<div class="grid grid-cols-[1rem_minmax(0,1fr)] gap-1 font-mono text-[12px] leading-snug max-sm:text-[12px]">
											<span class={`select-none ${line.sign === '-' ? 'text-status-error' : 'text-brand/80'}`}>{line.sign}</span>
											<span class={`whitespace-pre-wrap break-words [overflow-wrap:anywhere] ${line.sign === '-' ? 'text-status-error/90' : 'text-text-secondary'}`}>{line.text || ' '}</span>
										</div>
									{/each}
								</div>
							</div>
						{:else}
							<div class="relative min-w-0">
								<pre
									id={sectionBodyId(section)}
									class={`whitespace-pre-wrap break-words font-mono text-[12px] leading-snug text-text-secondary [overflow-wrap:anywhere] ${shouldCollapse(section) ? 'max-h-56 overflow-hidden' : ''}`}
								>{section.value}</pre>
							</div>
						{/if}

						{#if section.collapsible && !live}
							<button
								type="button"
								class="inline-flex min-h-7 items-center rounded-sm px-0 text-[12px] leading-none text-text-placeholder transition-colors hover:text-text-secondary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand/35 sm:min-h-5 max-sm:min-h-11 max-sm:px-1"
								aria-expanded={isExpanded(section)}
								aria-controls={sectionBodyId(section)}
								onclick={() => toggleSection(section.id)}
							>
								{isExpanded(section) ? 'Collapse' : 'Show full'}
							</button>
						{/if}
					</div>
				{/each}
			</div>
		{/if}
	</div>
{/if}
