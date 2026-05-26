<script lang="ts">
import { Check, ChevronDown, Copy } from "lucide-svelte";
import { onDestroy } from "svelte";
import type { MarkdownFrontmatterEntry } from "$lib/markdown-frontmatter";

type Props = {
	raw: string;
	entries?: MarkdownFrontmatterEntry[];
};

const { raw, entries = [] }: Props = $props();

let expanded = $state(false);
let copied = $state(false);
let copyTimer: ReturnType<typeof setTimeout> | null = null;

const visibleEntries = $derived(expanded ? entries : entries.slice(0, 6));
const hiddenCount = $derived(
	Math.max(entries.length - visibleEntries.length, 0),
);

async function copyRaw() {
	if (!raw) return;
	if (navigator.clipboard?.writeText) {
		await navigator.clipboard.writeText(raw);
	} else {
		const textArea = document.createElement("textarea");
		textArea.value = raw;
		textArea.style.position = "fixed";
		textArea.style.opacity = "0";
		document.body.appendChild(textArea);
		textArea.select();
		document.execCommand("copy");
		textArea.remove();
	}
	copied = true;
	if (copyTimer) clearTimeout(copyTimer);
	copyTimer = setTimeout(() => {
		copied = false;
	}, 1400);
}

onDestroy(() => {
	if (copyTimer) clearTimeout(copyTimer);
});
</script>

<section class="frontmatter-panel" aria-label="Markdown frontmatter">
	<div class="frontmatter-header">
		<div class="frontmatter-title-group">
			<div class="frontmatter-kicker">Frontmatter</div>
			<div class="frontmatter-title">Document metadata</div>
		</div>
		<button
			type="button"
			class="frontmatter-copy"
			onclick={() => void copyRaw()}
			aria-label="Copy frontmatter"
			title="Copy frontmatter"
		>
			{#if copied}
				<Check class="size-3.5" />
			{:else}
				<Copy class="size-3.5" />
			{/if}
		</button>
	</div>

	{#if visibleEntries.length > 0}
		<dl class="frontmatter-grid">
			{#each visibleEntries as entry}
				<div class="frontmatter-row">
					<dt>{entry.key}</dt>
					<dd>{entry.value}</dd>
				</div>
			{/each}
		</dl>
	{:else}
		<pre class="frontmatter-raw">{raw}</pre>
	{/if}

	{#if entries.length > 6 || visibleEntries.length > 0}
		<div class="frontmatter-footer">
			{#if entries.length > 6}
				<button
					type="button"
					class="frontmatter-toggle"
					aria-expanded={expanded}
					onclick={() => expanded = !expanded}
				>
					<span>{expanded ? "Show less" : `Show ${hiddenCount} more`}</span>
					<ChevronDown class={expanded ? "size-3.5 rotate-180" : "size-3.5"} />
				</button>
			{/if}
			<details class="frontmatter-details">
				<summary>Raw</summary>
				<pre>{raw}</pre>
			</details>
		</div>
	{/if}
</section>

<style>
.frontmatter-panel {
	container-type: inline-size;
	position: relative;
	max-width: 860px;
	margin: 0 auto;
	padding: 18px 28px 0;
	color: var(--text-secondary);
}

.frontmatter-panel::before {
	content: "";
	position: absolute;
	inset: 18px 28px auto;
	height: 1px;
	background: linear-gradient(
		90deg,
		var(--brand-border),
		color-mix(in srgb, var(--border-subtle) 70%, transparent) 32%,
		transparent
	);
}

.frontmatter-header {
	display: flex;
	align-items: flex-start;
	justify-content: space-between;
	gap: 12px;
	padding-top: 16px;
}

.frontmatter-title-group {
	min-width: 0;
}

.frontmatter-kicker {
	margin-bottom: 2px;
	color: var(--brand-muted-fg);
	font-family: var(--font-mono, monospace);
	font-size: 10px;
	font-weight: 650;
	letter-spacing: 0.12em;
	line-height: 1.2;
	text-transform: uppercase;
}

.frontmatter-title {
	color: var(--text-primary);
	font-size: 13px;
	font-weight: 600;
	line-height: 1.35;
}

.frontmatter-copy,
.frontmatter-toggle {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	border: 1px solid var(--border-subtle);
	border-radius: 0.45rem;
	background: transparent;
	color: var(--text-tertiary);
	cursor: pointer;
	transition:
		background-color 140ms ease,
		border-color 140ms ease,
		color 140ms ease,
		transform 140ms ease;
}

.frontmatter-copy {
	width: 32px;
	height: 32px;
	flex: 0 0 auto;
}

.frontmatter-copy:hover,
.frontmatter-toggle:hover,
.frontmatter-copy:focus-visible,
.frontmatter-toggle:focus-visible {
	border-color: var(--brand-border);
	background: var(--brand-muted);
	color: var(--text-primary);
	outline: none;
}

.frontmatter-copy:active,
.frontmatter-toggle:active {
	transform: translateY(1px);
}

.frontmatter-grid {
	display: grid;
	gap: 0;
	margin: 14px 0 0;
	border-top: 1px solid color-mix(in srgb, var(--border-subtle) 72%, transparent);
	font-size: 12px;
}

.frontmatter-row {
	display: grid;
	grid-template-columns: minmax(7rem, 0.32fr) minmax(0, 1fr);
	gap: 16px;
	padding: 8px 0;
	border-bottom: 1px solid color-mix(in srgb, var(--border-subtle) 46%, transparent);
}

.frontmatter-row dt {
	min-width: 0;
	color: var(--text-tertiary);
	font-family: var(--font-mono, monospace);
	font-size: 11px;
	line-height: 1.5;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.frontmatter-row dd {
	min-width: 0;
	margin: 0;
	color: var(--text-secondary);
	line-height: 1.5;
	overflow-wrap: anywhere;
}

.frontmatter-footer {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 10px;
	margin-top: 10px;
}

.frontmatter-toggle {
	min-height: 32px;
	gap: 6px;
	padding: 0 9px;
	font-size: 11px;
	font-weight: 500;
}

.frontmatter-toggle :global(svg) {
	transition: transform 140ms ease;
}

.frontmatter-details {
	margin-left: auto;
	font-size: 11px;
}

.frontmatter-details summary {
	min-height: 32px;
	padding: 7px 0;
	color: var(--text-tertiary);
	cursor: pointer;
	list-style: none;
}

.frontmatter-details summary::-webkit-details-marker {
	display: none;
}

.frontmatter-details summary:hover,
.frontmatter-details summary:focus-visible {
	color: var(--text-primary);
	outline: none;
}

.frontmatter-details pre,
.frontmatter-raw {
	max-height: 15rem;
	margin: 8px 0 0;
	padding: 10px 12px;
	border: 1px solid var(--border-subtle);
	border-radius: 0.55rem;
	background: var(--bg-code);
	color: var(--text-reading);
	font-family: var(--font-mono, monospace);
	font-size: 11px;
	line-height: 1.55;
	overflow: auto;
	white-space: pre-wrap;
}

@container (max-width: 520px) {
	.frontmatter-panel {
		padding: 14px 16px 0;
	}

	.frontmatter-panel::before {
		inset-inline: 16px;
		top: 14px;
	}

	.frontmatter-header {
		padding-top: 14px;
	}

	.frontmatter-row {
		grid-template-columns: 1fr;
		gap: 2px;
		padding: 9px 0;
	}

	.frontmatter-row dt {
		font-size: 10px;
	}

	.frontmatter-footer {
		align-items: stretch;
		flex-wrap: wrap;
	}

	.frontmatter-toggle {
		min-height: 40px;
	}

	.frontmatter-details {
		margin-left: 0;
	}

	.frontmatter-details summary {
		min-height: 40px;
	}
}

@media (prefers-reduced-motion: reduce) {
	.frontmatter-copy,
	.frontmatter-toggle,
	.frontmatter-toggle :global(svg) {
		transition: none;
	}
}
</style>
