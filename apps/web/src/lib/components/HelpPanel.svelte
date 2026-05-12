<script lang="ts">
import Dialog from "$lib/components/Dialog.svelte";

const {
	open,
	onClose,
}: {
	open: boolean;
	onClose: () => void;
} = $props();
</script>

<Dialog {open} {onClose} title="Help" maxWidth="620px">
	<div class="space-y-4 p-3.5 sm:p-4">
		<div class="shortcut-section">
			<div class="shortcut-section-title">Global</div>
			<div class="shortcut-grid">
				<div class="shortcut-item"><span>Search</span><span class="key-group"><kbd>⌘K</kbd><kbd>Ctrl K</kbd></span></div>
				<div class="shortcut-item"><span>New chat</span><span class="key-group"><kbd>⌘O</kbd><kbd>Ctrl O</kbd></span></div>
				<div class="shortcut-item"><span>Help</span><span class="key-group"><kbd>?</kbd></span></div>
			</div>
		</div>

		<div class="shortcut-section">
			<div class="shortcut-section-title">Session page</div>
			<div class="shortcut-grid">
				<div class="shortcut-item"><span>Focus composer</span><span class="key-group"><kbd>i</kbd></span></div>
				<div class="shortcut-item"><span>Scroll down</span><span class="key-group"><kbd>j</kbd></span></div>
				<div class="shortcut-item"><span>Scroll up</span><span class="key-group"><kbd>k</kbd></span></div>
				<div class="shortcut-item"><span>Next turn</span><span class="key-group"><kbd>Shift J</kbd></span></div>
				<div class="shortcut-item"><span>Previous turn</span><span class="key-group"><kbd>Shift K</kbd></span></div>
				<div class="shortcut-item"><span>Top</span><span class="key-group"><kbd>g</kbd><kbd>g</kbd></span></div>
				<div class="shortcut-item"><span>Bottom</span><span class="key-group"><kbd>G</kbd></span></div>
			</div>
		</div>

		<div class="shortcut-section">
			<div class="shortcut-section-title">Composer</div>
			<div class="shortcut-grid">
				<div class="shortcut-item"><span>Send</span><span class="key-group"><kbd>Enter</kbd></span></div>
				<div class="shortcut-item"><span>Force send</span><span class="key-group"><kbd>⌘↵</kbd><kbd>Ctrl ↵</kbd></span></div>
				<div class="shortcut-item"><span>New line</span><span class="key-group"><kbd>Shift ↵</kbd></span></div>
				<div class="shortcut-item"><span>Blur</span><span class="key-group"><kbd>Esc</kbd></span></div>
			</div>
		</div>

		<div class="shortcut-section">
			<div class="shortcut-section-title">Files</div>
			<div class="shortcut-grid">
				<div class="shortcut-item"><span>Save file</span><span class="key-group"><kbd>⌘S</kbd><kbd>Ctrl S</kbd></span></div>
			</div>
		</div>

		<div class="doc-placeholder">
			<div class="text-[12px] font-medium text-text-secondary">Documentation</div>
			<div class="mt-0.5 text-[12px] leading-5 text-text-tertiary">Project guides and deeper workflow docs will appear here.</div>
		</div>
	</div>
</Dialog>

<style>
	.shortcut-section-title {
		margin-bottom: 0.45rem;
		font-size: 10px;
		font-weight: 650;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--text-placeholder);
	}
	.shortcut-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
		gap: 1px;
		overflow: hidden;
		border: 1px solid var(--border-subtle);
		border-radius: 9px;
		background: var(--border-subtle);
	}
	.shortcut-item {
		display: flex;
		min-height: 34px;
		align-items: center;
		justify-content: space-between;
		gap: 0.55rem;
		background: color-mix(in oklab, var(--bg-surface) 92%, var(--bg-primary));
		padding: 0.42rem 0.55rem;
		font-size: 12px;
		color: var(--text-secondary);
	}
	.key-group {
		display: inline-flex;
		flex-wrap: wrap;
		justify-content: flex-end;
		gap: 0.25rem;
	}
	kbd {
		display: inline-flex;
		min-width: 1.45rem;
		height: 1.35rem;
		align-items: center;
		justify-content: center;
		border: 1px solid color-mix(in oklab, var(--border-strong) 80%, var(--brand));
		border-bottom-color: color-mix(in oklab, var(--border-strong) 72%, black);
		border-radius: 5px;
		background: color-mix(in oklab, var(--bg-primary) 94%, var(--brand));
		padding: 0 0.36rem;
		font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
		font-size: 10px;
		font-weight: 600;
		line-height: 1;
		color: var(--text-primary);
		box-shadow: inset 0 -1px 0 color-mix(in oklab, var(--border-strong) 80%, transparent);
	}
	.doc-placeholder {
		border: 1px solid var(--border-subtle);
		border-radius: 8px;
		background: var(--bg-surface);
		padding: 0.65rem 0.75rem;
	}
</style>
