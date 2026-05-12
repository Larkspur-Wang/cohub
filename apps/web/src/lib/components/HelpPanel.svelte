<script lang="ts">
import Dialog from "$lib/components/Dialog.svelte";

type ShortcutCombo = string[];

type ShortcutItem = {
	label: string;
	keys: ShortcutCombo[];
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
			{
				label: "Search everywhere",
				keys: [
					["⌘", "K"],
					["Ctrl", "K"],
				],
			},
			{
				label: "New chat",
				keys: [
					["⌘", "O"],
					["Ctrl", "O"],
				],
			},
			{ label: "Open help", keys: [["?"]] },
		],
	},
	{
		title: "Session page",
		description: "Vim-style reading and turn navigation.",
		items: [
			{ label: "Focus composer", keys: [["i"]] },
			{ label: "Scroll down", keys: [["j"]] },
			{ label: "Scroll up", keys: [["k"]] },
			{ label: "Next turn", keys: [["Shift", "J"]] },
			{ label: "Previous turn", keys: [["Shift", "K"]] },
			{ label: "Top", keys: [["g", "g"]] },
			{ label: "Bottom", keys: [["G"]] },
		],
	},
	{
		title: "Composer",
		description: "When the message input is focused.",
		items: [
			{ label: "Send", keys: [["Enter"]] },
			{
				label: "Force send",
				keys: [
					["⌘", "↵"],
					["Ctrl", "↵"],
				],
			},
			{ label: "New line", keys: [["Shift", "↵"]] },
			{ label: "Blur", keys: [["Esc"]] },
		],
	},
	{
		title: "Files",
		description: "File preview and editor shortcuts.",
		items: [
			{
				label: "Save file",
				keys: [
					["⌘", "S"],
					["Ctrl", "S"],
				],
			},
		],
	},
];
</script>

<Dialog {open} {onClose} title="Help" maxWidth="700px">
	<div class="help-sheet">
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
								<span class="key-group" aria-label={item.keys.map((combo) => combo.join(" ")).join(" or ")}>
									{#each item.keys as combo, comboIndex (`${section.title}:${item.label}:${comboIndex}`)}
										<span class="key-combo">
											{#each combo as key, keyIndex (`${section.title}:${item.label}:${comboIndex}:${keyIndex}`)}
												<kbd>{key}</kbd>
											{/each}
										</span>
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
</Dialog>

<style>
	.help-sheet {
		padding: 0.54rem 0.6rem 0.68rem;
		background: var(--bg-primary);
	}
	.shortcut-stack {
		display: grid;
		gap: 0;
	}
	.shortcut-section {
		display: grid;
		grid-template-columns: minmax(7rem, 0.24fr) minmax(0, 1fr);
		gap: 0.72rem;
		align-items: start;
		border-top: 1px solid color-mix(in oklab, var(--border-subtle) 84%, transparent);
		padding: 0.52rem 0;
	}
	.shortcut-section:first-child {
		border-top: 0;
		padding-top: 0;
	}
	.shortcut-section:last-child {
		padding-bottom: 0;
	}
	.section-meta {
		display: grid;
		gap: 0.12rem;
		padding-top: 0.08rem;
	}
	.section-meta h3 {
		margin: 0;
		font-size: 11px;
		font-weight: 750;
		letter-spacing: 0.09em;
		line-height: 1.25;
		text-transform: uppercase;
		color: var(--text-primary);
	}
	.section-meta p {
		margin: 0;
		max-width: 11rem;
		font-size: 11px;
		line-height: 1.35;
		color: color-mix(in oklab, var(--text-secondary) 55%, var(--text-tertiary));
	}
	.shortcut-flow {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr));
		gap: 0.16rem 0.42rem;
	}
	.shortcut-chip {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		align-items: center;
		gap: 0.5rem;
		min-height: 1.42rem;
		padding: 0.03rem 0;
		border-radius: 8px;
		transition: background-color 120ms ease;
	}
	.shortcut-chip:hover {
		background: color-mix(in oklab, var(--brand) 4%, transparent);
	}
	.shortcut-label {
		min-width: 0;
		font-size: 12px;
		font-weight: 580;
		line-height: 1.15;
		color: var(--text-primary);
	}
	.key-group {
		display: inline-flex;
		flex-wrap: wrap;
		justify-content: flex-end;
		gap: 0.38rem;
		padding: 0.14rem 0.2rem;
		border: 1px solid color-mix(in oklab, var(--brand) 20%, var(--border-subtle));
		border-radius: 8px;
		background: color-mix(in oklab, var(--brand) 4%, var(--bg-secondary));
	}
	.key-combo {
		display: inline-flex;
		align-items: center;
		gap: 0.08rem;
		white-space: nowrap;
	}
	kbd {
		display: inline-flex;
		min-width: 1.28rem;
		height: 1.18rem;
		align-items: center;
		justify-content: center;
		border: 0;
		border-radius: 5px;
		background: transparent;
		padding: 0 0.08rem;
		font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
		font-size: 10px;
		font-weight: 800;
		letter-spacing: 0.01em;
		line-height: 1;
		color: color-mix(in oklab, var(--brand) 92%, var(--text-primary));
	}
	.shortcut-chip:hover .key-group {
		border-color: color-mix(in oklab, var(--brand) 30%, var(--border-subtle));
		background: color-mix(in oklab, var(--brand) 6%, var(--bg-secondary));
	}
	.doc-card {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.9rem;
		max-width: 100%;
		padding: 0.04rem 0 0.02rem;
	}
	.doc-copy-wrap {
		min-width: 0;
	}
	.doc-title {
		font-size: 12px;
		font-weight: 650;
		color: var(--text-primary);
	}
	.doc-copy {
		margin-top: 0.08rem;
		font-size: 11px;
		line-height: 1.35;
		color: color-mix(in oklab, var(--text-secondary) 48%, var(--text-tertiary));
	}
	.doc-status {
		border-radius: 999px;
		background: color-mix(in oklab, var(--brand) 10%, var(--bg-primary));
		padding: 0.16rem 0.46rem;
		font-size: 10px;
		font-weight: 750;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--brand);
	}
	@media (max-width: 640px) {
		.help-sheet {
			padding: 0.6rem;
		}
		.shortcut-section {
			grid-template-columns: 1fr;
			gap: 0.36rem;
		}
		.section-meta p {
			max-width: none;
		}
		.shortcut-flow {
			grid-template-columns: 1fr;
			gap: 0.2rem;
		}
		.shortcut-chip {
			grid-template-columns: minmax(0, 1fr);
			gap: 0.28rem;
		}
		.key-group {
			justify-self: start;
		}
	}
</style>
