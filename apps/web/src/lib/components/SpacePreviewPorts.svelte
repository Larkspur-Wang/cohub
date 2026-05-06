<script lang="ts">
import type { SpacePublicEndpoints } from "@neta-art/cohub-protocol/ports";
import { ExternalLink } from "lucide-svelte";

const { endpoints = {} }: { endpoints?: SpacePublicEndpoints } = $props();

const items = $derived.by(() =>
	Object.entries(endpoints)
		.map(([port, endpoint]) => ({ port, ...endpoint }))
		.sort((a, b) => Number(a.port) - Number(b.port)),
);

function statusLabel(status: string | undefined) {
	if (status === "listening") return "Live";
	if (status === "closed") return "Idle";
	return "Detecting";
}
</script>

{#if items.length > 0}
	<div class="border-b border-border-subtle px-3 py-2">
		<div class="mb-1.5 flex items-center justify-between gap-2">
			<div class="text-[11px] uppercase tracking-[0.14em] text-text-tertiary">Preview</div>
		</div>
		<div class="flex flex-wrap gap-1.5">
			{#each items as item (item.port)}
				<a
					class="group inline-flex max-w-full items-center gap-1.5 rounded-full border px-2 py-1 text-[11px] transition-colors {item.status === 'listening' ? 'border-success-soft/35 bg-success-bg text-success-soft hover:border-success-soft/60' : 'border-border-subtle bg-bg-surface text-text-tertiary hover:border-border-strong hover:text-text-secondary'}"
					href={item.url}
					target="_blank"
					rel="noreferrer"
					title={`Open port ${item.port} preview`}
				>
					<span class="h-1.5 w-1.5 rounded-full {item.status === 'listening' ? 'bg-success-soft' : 'bg-text-placeholder'}"></span>
					<span class="font-medium">:{item.port}</span>
					<span class="text-[10px] opacity-80">{statusLabel(item.status)}</span>
					<ExternalLink class="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-70" />
				</a>
			{/each}
		</div>
	</div>
{/if}
