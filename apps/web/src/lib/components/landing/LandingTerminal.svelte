<script lang="ts">
/**
 * Terminal block for the marketing page.
 *
 * Real text rather than a screenshot: it stays sharp at any width, is
 * selectable and copyable, follows the theme, and costs a few hundred bytes
 * instead of a bitmap. Long output wraps like a narrow terminal would, so the
 * block never scrolls sideways on a phone.
 *
 * Content comes from actual `cohub` runs — the session and turn ids, file
 * size, and timestamps below are what the CLI printed.
 */

type Line =
	| { kind: "command"; text: string; arg?: string; flags?: string }
	| { kind: "ok"; text: string; detail?: string }
	| { kind: "out"; text: string; dim?: boolean }
	| { kind: "gap" };

type Props = {
	title?: string;
	lines: Line[];
};

const { title = "cohub", lines }: Props = $props();
</script>

<div class="term">
	<div class="bar">
		<span class="dots" aria-hidden="true">
			<i style="background:#ff5f57"></i>
			<i style="background:#febc2e"></i>
			<i style="background:#28c840"></i>
		</span>
		<span class="title">{title}</span>
	</div>

	<pre class="body"><code>
		{#each lines as line, i (i)}
			{#if line.kind === "gap"}
				<span class="gap" aria-hidden="true"></span>
			{:else if line.kind === "command"}
				<span class="line"><span class="prompt">$</span> <span class="cmd"
						>{line.text}</span
					>{#if line.arg}<span class="arg"> {line.arg}</span>{/if}{#if line.flags}<span
							class="flags"> {line.flags}</span
						>{/if}</span
				>
			{:else if line.kind === "ok"}
				<span class="line"><span class="ok">✓</span> {line.text}{#if line.detail}<span
							class="dim">{line.detail}</span
						>{/if}</span
				>
			{:else}
				<span class="line {line.dim ? 'dim' : ''}">{line.text}</span>
			{/if}
		{/each}
		<span class="line"><span class="prompt">$</span> <span
				class="cursor"
				aria-hidden="true"
			></span></span
		>
	</code></pre>
</div>

<style>
	.term {
		overflow: hidden;
		border: 1px solid var(--border-subtle);
		border-radius: 8px;
		background: var(--bg-code);
	}

	.bar {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		border-bottom: 1px solid var(--border-subtle);
		background: var(--bg-surface);
		padding: 0.5rem 0.75rem;
	}

	.dots {
		display: flex;
		gap: 0.375rem;
	}

	.dots i {
		width: 9px;
		height: 9px;
		border-radius: 50%;
	}

	.title {
		font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
		font-size: 11px;
		color: var(--text-placeholder);
	}

	.body {
		margin: 0;
		padding: 0.875rem 0.875rem 1rem;
		font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
		font-size: 12.5px;
		line-height: 1.7;
		color: var(--text-secondary);
		/* Lines are block elements, so template indentation must not render. */
		white-space: normal;
	}

	.line {
		display: block;
		/* Wrap instead of scrolling: a turn id is longer than a phone is wide. */
		overflow-wrap: anywhere;
		white-space: pre-wrap;
	}

	.gap {
		display: block;
		height: 0.7em;
	}

	.prompt {
		color: var(--text-placeholder);
		user-select: none;
	}

	.cmd {
		color: var(--text-primary);
		font-weight: 500;
	}

	/* Quoted operand — the one place brand colour earns its keep here. */
	.arg {
		color: var(--brand);
	}

	.flags {
		color: var(--text-tertiary);
	}

	.ok {
		color: var(--color-success);
	}

	.dim {
		color: var(--text-placeholder);
	}

	.cursor {
		display: inline-block;
		width: 7px;
		height: 1em;
		background: var(--text-placeholder);
		vertical-align: text-bottom;
	}

	@media (min-width: 720px) {
		.body {
			font-size: 13px;
		}
	}
</style>
