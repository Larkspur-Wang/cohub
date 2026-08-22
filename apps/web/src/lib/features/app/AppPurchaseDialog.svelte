<script lang="ts">
import { CreditCard, Loader2 } from "lucide-svelte";
import Dialog from "$lib/components/Dialog.svelte";

const {
	open,
	pending,
	error,
	saving,
	onConfirm,
	onCancel,
}: {
	open: boolean;
	pending: { productKey: string } | null;
	error: string | null;
	saving: boolean;
	onConfirm: () => void;
	onCancel: () => void;
} = $props();
</script>

<Dialog {open} onClose={onCancel} title="Complete purchase" maxWidth="420px">
	{#if pending}
		<div class="auth-panel">
			<div class="auth-intro">
				<div class="auth-icon"><CreditCard class="h-4 w-4" /></div>
				<div class="min-w-0">
					<div class="auth-title">Continue to checkout?</div>
					<p class="auth-copy">This app wants to open a secure checkout for <span class="font-mono">{pending.productKey}</span>.</p>
				</div>
			</div>
			{#if error}
				<div class="mt-3 rounded-[8px] border border-error-soft/30 bg-error-bg px-3 py-2 text-[12px] text-error-soft">{error}</div>
			{/if}
			<div class="auth-actions">
				<button type="button" class="auth-cancel" onclick={onCancel} disabled={saving}>Cancel</button>
				<button type="button" class="auth-confirm" onclick={onConfirm} disabled={saving}>
					{#if saving}<Loader2 class="h-3.5 w-3.5 animate-spin" />{/if}
					<span>{saving ? 'Opening…' : 'Continue'}</span>
				</button>
			</div>
		</div>
	{/if}
</Dialog>

<style>
	.auth-panel {
		display: grid;
		gap: 18px;
		padding: 16px;
	}

	.auth-intro {
		display: grid;
		grid-template-columns: 34px minmax(0, 1fr);
		gap: 12px;
		align-items: flex-start;
	}

	.auth-icon {
		display: inline-flex;
		width: 34px;
		height: 34px;
		align-items: center;
		justify-content: center;
		border-radius: 9px;
		background: var(--brand-muted);
		color: var(--brand-muted-fg);
		border: 1px solid var(--brand-border);
		box-shadow: inset 0 1px 0 color-mix(in srgb, var(--bg-elevated) 80%, transparent);
	}

	.auth-title {
		font-size: 15px;
		font-weight: 650;
		line-height: 1.25;
		letter-spacing: -0.01em;
		color: var(--text-primary);
	}

	.auth-copy {
		margin-top: 6px;
		font-size: 13px;
		line-height: 1.55;
		color: var(--text-secondary);
	}

	.auth-actions {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
		padding-top: 2px;
	}

	.auth-cancel,
	.auth-confirm {
		display: inline-flex;
		height: 34px;
		min-width: 72px;
		align-items: center;
		justify-content: center;
		gap: 6px;
		border-radius: 7px;
		padding: 0 13px;
		font-size: 12.5px;
		font-weight: 650;
		line-height: 1;
		transition:
			background-color 0.15s ease,
			border-color 0.15s ease,
			color 0.15s ease,
			transform 0.15s ease,
			opacity 0.15s ease;
	}

	.auth-cancel {
		border: 1px solid transparent;
		color: var(--text-secondary);
	}

	.auth-cancel:hover {
		background: var(--bg-hover);
		color: var(--text-primary);
	}

	.auth-confirm {
		border: 1px solid var(--brand);
		background: var(--brand);
		color: var(--brand-contrast-fg);
	}

	.auth-confirm:hover {
		background: var(--brand-hover);
		border-color: var(--brand-hover);
	}

	.auth-cancel:focus-visible,
	.auth-confirm:focus-visible {
		outline: none;
		box-shadow: 0 0 0 2px var(--bg-primary), 0 0 0 4px var(--brand-ring);
	}

	.auth-cancel:active,
	.auth-confirm:active {
		transform: translateY(1px);
	}

	.auth-cancel:disabled,
	.auth-confirm:disabled {
		pointer-events: none;
		opacity: 0.55;
		transform: none;
	}

	@media (max-width: 640px) {
		.auth-panel {
			gap: 16px;
			padding: 14px 14px max(14px, env(safe-area-inset-bottom));
		}

		.auth-intro {
			grid-template-columns: 32px minmax(0, 1fr);
			gap: 11px;
		}

		.auth-icon {
			width: 32px;
			height: 32px;
		}

		.auth-title {
			font-size: 14.5px;
		}

		.auth-copy {
			font-size: 13px;
			line-height: 1.5;
		}

		.auth-actions {
			position: sticky;
			bottom: calc(-1 * max(14px, env(safe-area-inset-bottom)));
			display: grid;
			grid-template-columns: 1fr 1fr;
			margin: 0 -14px calc(-1 * max(14px, env(safe-area-inset-bottom)));
			padding: 10px 14px max(14px, env(safe-area-inset-bottom));
			border-top: 1px solid var(--border-subtle);
			background: var(--bg-primary);
		}

		.auth-cancel,
		.auth-confirm {
			height: 44px;
			min-width: 0;
		}
	}
</style>
