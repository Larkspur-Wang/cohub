<script lang="ts">
import Dialog from "$lib/components/Dialog.svelte";

type ShortcutItem = {
	label: string;
	keys: string[];
};

type ShortcutSection = {
	title: string;
	description: string;
	items: ShortcutItem[];
};

const {
	open,
	onClose,
}: {
	open: boolean;
	onClose: () => void;
} = $props();

const sections: ShortcutSection[] = [
	{
		title: "Global",
		description: "Available across Cohub.",
		items: [
			{ label: "Search everywhere", keys: ["⌘ K", "Ctrl K"] },
			{ label: "New chat", keys: ["⌘ O", "Ctrl O"] },
			{ label: "Open help", keys: ["?"] },
		],
	},
	{
		title: "Session page",
		description: "Vim-style reading and turn navigation.",
		items: [
			{ label: "Focus composer", keys: ["i"] },
			{ label: "Scroll down", keys: ["j"] },
			{ label: "Scroll up", keys: ["k"] },
			{ label: "Next turn", keys: ["Shift J"] },
			{ label: "Previous turn", keys: ["Shift K"] },
			{ label: "Top", keys: ["g", "g"] },
			{ label: "Bottom", keys: ["G"] },
		],
	},
	{
		title: "Composer",
		description: "When the message input is focused.",
		items: [
			{ label: "Send", keys: ["Enter"] },
			{ label: "Force send", keys: ["⌘ ↵", "Ctrl ↵"] },
			{ label: "New line", keys: ["Shift ↵"] },
			{ label: "Blur", keys: ["Esc"] },
		],
	},
	{
		title: "Files",
		description: "File preview and editor shortcuts.",
		items: [{ label: "Save file", keys: ["⌘ S", "Ctrl S"] }],
	},
];
</script>

<Dialog {open} {onClose} title="Help" maxWidth="660px">
	<div class="help-sheet">
		<div class="help-grid">
			<div class="shortcut-stack">
				{#each sections as section (section.title)}
					<section class="shortcut-section" aria-labelledby={`help-section-${section.title}`}>
						<div class="section-meta">
							<h3 id={`help-section-${section.title}`}>{section.title}</h3>
							<p>{section.description}</p>
						</div>
						<div class="shortcut-flow">
							{#each section.items as item (`${section.title}:${item.label}`)}
								<div class="shortcut-chip">
									<span class="shortcut-label">{item.label}</span>
									<span class="key-group" aria-label={item.keys.join(" or ")}>
										{#each item.keys as key, index (`${item.label}:${key}:${index}`)}
											<kbd>{key}</kbd>
										{/each}
									</span>
								</div>
							{/each}
						</div>
					</section>
				{/each}

				<section class="shortcut-section doc-section" aria-labelledby="help-section-docs">
					<div class="section-meta">
						<h3 id="help-section-docs">Documentation</h3>
						<p>Guides and workflow docs.</p>
					</div>
					<div class="doc-card">
						<div class="doc-copy-wrap">
							<div class="doc-title">Project documentation</div>
							<div class="doc-copy">Deeper guides will appear here.</div>
						</div>
						<span class="doc-status">Soon</span>
					</div>
				</section>
			</div>
		</div>
	</div>
</Dialog>

<style>
	.help-sheet {
		padding: 0.85rem 0.75rem 0.95rem;
		background: var(--bg-primary);
	}
	.help-grid {
		display: grid;
		grid-template-columns: 1fr;
	}
	.shortcut-stack {
		display: grid;
		gap: 0;
	}
	.shortcut-section {
		display: grid;
		grid-template-columns: minmax(7.5rem, 0.32fr) minmax(0, 1fr);
		gap: 0.85rem;
		align-items: start;
		border-top: 1px solid color-mix(in oklab, var(--border-subtle) 72%, transparent);
		padding: 0.72rem 0;
	}
	.shortcut-section:first-child {
		border-top: 0;
		padding-top: 0;
	}
	.shortcut-section:last-child {
		padding-bottom: 0;
	}
	.section-meta h3 {
		margin: 0;
		font-size: 11px;
		font-weight: 700;
		letter-spacing: 0.075em;
		line-height: 1.35;
		text-transform: uppercase;
		color: var(--text-primary);
	}
	.section-meta p {
		margin: 0.28rem 0 0;
		max-width: 11rem;
		font-size: 11px;
		line-height: 1.45;
		color: var(--text-placeholder);
	}
	.shortcut-flow {
		display: flex;
		flex-wrap: wrap;
		gap: 0.38rem 0.68rem;
	}
	.shortcut-chip {
		display: inline-flex;
		align-items: center;
		gap: 0.42rem;
		min-height: 1.75rem;
		border-radius: 6px;
		padding: 0.16rem 0;
		transition:
			background-color 120ms ease,
			color 120ms ease;
	}
	.shortcut-chip:hover {
		background: transparent;
	}
	.shortcut-label {
		white-space: nowrap;
		font-size: 12px;
		font-weight: 500;
		line-height: 1;
		color: var(--text-secondary);
	}
	.key-group {
		display: inline-flex;
		flex-wrap: wrap;
		justify-content: flex-end;
		gap: 0.18rem;
	}
	kbd {
		display: inline-flex;
		min-width: 1.42rem;
		height: 1.24rem;
		align-items: center;
		justify-content: center;
		border: 1px solid color-mix(in oklab, var(--brand) 38%, var(--border-subtle));
		border-radius: 5px;
		background: color-mix(in oklab, var(--brand) 13%, var(--bg-primary));
		padding: 0 0.34rem;
		font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
		font-size: 10px;
		font-weight: 750;
		letter-spacing: 0.025em;
		line-height: 1;
		color: color-mix(in oklab, var(--brand) 74%, var(--text-primary));
	}
	.doc-card {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		max-width: 100%;
		padding: 0;
	}
	.doc-copy-wrap {
		min-width: 0;
	}
	.doc-title {
		font-size: 12px;
		font-weight: 650;
		color: var(--text-secondary);
	}
	.doc-copy {
		margin-top: 0.1rem;
		font-size: 11px;
		line-height: 1.45;
		color: var(--text-tertiary);
	}
	.doc-status {
		border-radius: 999px;
		background: color-mix(in oklab, var(--brand) 10%, var(--bg-primary));
		padding: 0.18rem 0.48rem;
		font-size: 10px;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--brand);
	}
	@media (max-width: 640px) {
		.help-sheet {
			padding: 0.75rem;
		}
		.shortcut-section {
			grid-template-columns: 1fr;
			gap: 0.48rem;
		}
		.section-meta p {
			max-width: none;
		}
		.shortcut-flow {
			gap: 0.35rem;
		}
		.shortcut-chip {
			max-width: 100%;
		}
	}
</style>
