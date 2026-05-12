<script lang="ts">
import { Keyboard } from "lucide-svelte";
import Dialog from "$lib/components/Dialog.svelte";

const {
	open,
	onClose,
}: {
	open: boolean;
	onClose: () => void;
} = $props();
</script>

<Dialog {open} {onClose} title="Help" maxWidth="580px">
	<div class="p-4 sm:p-5">
		<div class="mb-4 flex items-start gap-3 rounded-[8px] border border-brand/15 bg-brand/8 px-3 py-2.5">
			<div class="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] bg-brand/12 text-brand">
				<Keyboard class="h-4 w-4" />
			</div>
			<div class="min-w-0">
				<div class="text-[13px] font-medium text-text-primary">Cohub help</div>
				<div class="mt-0.5 text-[12px] leading-5 text-text-tertiary">
					Quick reference for shortcuts and workflow aids. Press <kbd class="shortcut-key">Esc</kbd> to close this panel.
				</div>
			</div>
		</div>

		<div class="shortcut-section">
			<div class="shortcut-section-title">Global</div>
			<div class="shortcut-grid">
				<div class="shortcut-row"><span>Search everywhere</span><kbd class="shortcut-key">⌘K</kbd><kbd class="shortcut-key">Ctrl K</kbd></div>
				<div class="shortcut-row"><span>New chat</span><kbd class="shortcut-key">⌘O</kbd><kbd class="shortcut-key">Ctrl O</kbd></div>
				<div class="shortcut-row"><span>Open help</span><kbd class="shortcut-key">?</kbd></div>
			</div>
		</div>

		<div class="shortcut-section mt-4">
			<div class="shortcut-section-title">Session page</div>
			<div class="shortcut-grid">
				<div class="shortcut-row"><span>Focus composer</span><kbd class="shortcut-key">i</kbd></div>
				<div class="shortcut-row"><span>Scroll down</span><kbd class="shortcut-key">j</kbd></div>
				<div class="shortcut-row"><span>Scroll up</span><kbd class="shortcut-key">k</kbd></div>
				<div class="shortcut-row"><span>Next turn</span><kbd class="shortcut-key">Shift J</kbd></div>
				<div class="shortcut-row"><span>Previous turn</span><kbd class="shortcut-key">Shift K</kbd></div>
				<div class="shortcut-row"><span>Top</span><kbd class="shortcut-key">g</kbd><kbd class="shortcut-key">g</kbd></div>
				<div class="shortcut-row"><span>Bottom</span><kbd class="shortcut-key">G</kbd></div>
			</div>
		</div>

		<div class="shortcut-section mt-4">
			<div class="shortcut-section-title">Composer</div>
			<div class="shortcut-grid">
				<div class="shortcut-row"><span>Send message</span><kbd class="shortcut-key">Enter</kbd></div>
				<div class="shortcut-row"><span>Force send</span><kbd class="shortcut-key">⌘↵</kbd><kbd class="shortcut-key">Ctrl ↵</kbd></div>
				<div class="shortcut-row"><span>New line</span><kbd class="shortcut-key">Shift ↵</kbd></div>
				<div class="shortcut-row"><span>Blur composer</span><kbd class="shortcut-key">Esc</kbd></div>
			</div>
		</div>

		<div class="shortcut-section mt-4">
			<div class="shortcut-section-title">Files</div>
			<div class="shortcut-grid">
				<div class="shortcut-row"><span>Save file</span><kbd class="shortcut-key">⌘S</kbd><kbd class="shortcut-key">Ctrl S</kbd></div>
			</div>
		</div>

		<div class="mt-4 rounded-[8px] border border-border-subtle bg-bg-surface px-3 py-2.5">
			<div class="text-[12px] font-medium text-text-secondary">Documentation</div>
			<div class="mt-0.5 text-[12px] leading-5 text-text-tertiary">Project guides and deeper workflow docs will appear here.</div>
		</div>
	</div>
</Dialog>

<style>
	.shortcut-section-title {
		margin-bottom: 0.5rem;
		font-size: 11px;
		font-weight: 600;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--text-placeholder);
	}
	.shortcut-grid {
		overflow: hidden;
		border: 1px solid var(--border-subtle);
		border-radius: 9px;
		background: color-mix(in oklab, var(--bg-surface) 92%, var(--bg-primary));
	}
	.shortcut-row {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto auto;
		align-items: center;
		gap: 0.4rem;
		min-height: 38px;
		padding: 0.45rem 0.65rem;
		border-bottom: 1px solid var(--border-subtle);
		font-size: 13px;
		color: var(--text-secondary);
	}
	.shortcut-row:last-child {
		border-bottom: 0;
	}
	.shortcut-key {
		display: inline-flex;
		min-width: 1.65rem;
		height: 1.45rem;
		align-items: center;
		justify-content: center;
		border: 1px solid color-mix(in oklab, var(--border-strong) 80%, var(--brand));
		border-bottom-color: color-mix(in oklab, var(--border-strong) 72%, black);
		border-radius: 5px;
		background: color-mix(in oklab, var(--bg-primary) 94%, var(--brand));
		padding: 0 0.42rem;
		font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
		font-size: 10px;
		font-weight: 600;
		line-height: 1;
		color: var(--text-primary);
		box-shadow: inset 0 -1px 0 color-mix(in oklab, var(--border-strong) 80%, transparent);
	}
</style>
