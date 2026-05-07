<script lang="ts">
import type { SpacePublicEndpoints } from "@neta-art/cohub-protocol/ports";
import { ExternalLink } from "lucide-svelte";

const {
	endpoints = {},
	activePort = null,
	onOpen,
}: {
	endpoints?: SpacePublicEndpoints;
	activePort?: string | null;
	onOpen?: (port: string, url: string) => void;
} = $props();

const items = $derived.by(() =>
	Object.entries(endpoints)
		.map(([port, endpoint]) => ({ port, ...endpoint }))
		.sort((a, b) => Number(a.port) - Number(b.port)),
);

function statusTooltip(status: string | undefined) {
	if (status === "listening") return "Listening";
	if (status === "closed") return "Closed";
	return "Detecting";
}
</script>

{#if items.length > 0}
	<div class="border-b border-border-subtle px-3 py-2">
		<div class="mb-1.5 flex items-center justify-between gap-2">
			<div class="text-[11px] uppercase tracking-[0.14em] text-text-tertiary">Ports</div>
		</div>
		<div class="flex flex-wrap gap-1.5">
			{#each items as item (item.port)}
				<div
					class="group inline-flex max-w-full items-center overflow-hidden rounded-full border text-[11px] transition-colors {activePort === item.port ? 'border-brand/60 bg-brand/10 text-brand' : item.status === 'listening' ? 'border-success-soft/35 bg-success-bg text-success-soft hover:border-success-soft/60' : 'border-border-subtle bg-bg-surface text-text-tertiary hover:border-border-strong hover:text-text-secondary'}"
					title={`:${item.port} — ${statusTooltip(item.status)}`}
				>
					<button
						type="button"
						class="inline-flex min-w-0 items-center gap-1.5 px-2 py-1 text-left font-medium"
						onclick={() => onOpen?.(item.port, item.url)}
					>
						<span class="h-1.5 w-1.5 rounded-full {item.status === 'listening' ? 'bg-success-soft' : 'bg-text-placeholder'}"></span>
						<span>:{item.port}</span>
					</button>
					<a
						class="inline-flex h-6 w-6 shrink-0 items-center justify-center border-l border-current/10 opacity-55 transition-opacity hover:opacity-100"
						href={item.url}
						target="_blank"
						rel="noreferrer"
						title={`Open :${item.port} externally`}
						onclick={(event) => event.stopPropagation()}
					>
						<ExternalLink class="h-3 w-3" />
					</a>
				</div>
			{/each}
		</div>
	</div>
{/if}
