<script lang="ts">
import type { Permission } from "@neta-art/cohub";
import { AlertTriangle, Check, Loader2, ShieldCheck } from "lucide-svelte";
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
	pending: { scopes: Permission[]; reason?: string } | null;
	error: string | null;
	saving: boolean;
	onConfirm: () => void;
	onCancel: () => void;
} = $props();

function formatScopeLabel(scope: string) {
	const labels: Record<string, string> = {
		"session.prompt.readonly": "Prompt read-only",
		"session.prompt.fullaccess": "Prompt full access",
		"generation.create": "Create generations",
		"file.view": "View files",
		"taskrun.view": "View task runs",
		"user.space.list": "List your spaces",
		"user.session.list": "List your sessions",
		"user.usage.read": "Read your usage",
	};
	return labels[scope] ?? scope;
}

function formatScopeDescription(scope: string) {
	const descriptions: Record<string, string> = {
		"session.prompt.readonly":
			"Read prompts and session context without making changes.",
		"session.prompt.fullaccess":
			"Send prompts and act in the session with your approval.",
		"generation.create": "Start image, video, or other generation tasks.",
		"file.view": "Read files in this space.",
		"taskrun.view": "View task progress and results in this space.",
		"user.space.list":
			"See the list of spaces you own or belong to across your account.",
		"user.session.list": "See sessions you created across all your spaces.",
		"user.usage.read": "Read your aggregated token usage and cost statistics.",
	};
	return (
		descriptions[scope] ?? "Grant this work the requested Cohub permission."
	);
}
</script>

<Dialog {open} onClose={onCancel} title="Work access" maxWidth="440px">
	{#if pending}
		<div class="auth-panel">
			<div class="auth-intro">
				<div class="auth-icon"><ShieldCheck class="h-4 w-4" /></div>
				<div class="min-w-0">
					<div class="auth-title">Allow work access?</div>
					<p class="auth-copy">{pending.reason || "This work wants to use Cohub on your behalf."}</p>
				</div>
			</div>

			<section class="auth-section">
				<div class="auth-section-label">Requested permissions</div>
				<div class="auth-scope-list">
					{#each pending.scopes as scope}
						<div class="auth-scope-row">
							<div class="auth-scope-check"><Check class="h-3 w-3" /></div>
							<div class="min-w-0">
								<div class="auth-scope-name">{formatScopeLabel(scope)}</div>
								<div class="auth-scope-description">{formatScopeDescription(scope)}</div>
							</div>
						</div>
					{/each}
				</div>
			</section>

			{#if error}
				<div class="auth-error"><AlertTriangle class="h-3.5 w-3.5" /> {error}</div>
			{/if}

			<div class="auth-actions">
				<button type="button" class="auth-cancel" disabled={saving} onclick={onCancel}>Cancel</button>
				<button type="button" class="auth-confirm" disabled={saving} onclick={onConfirm}>
					{#if saving}<Loader2 class="h-3.5 w-3.5 animate-spin" />{/if}
					Allow
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

	.auth-section {
		display: grid;
		gap: 9px;
	}

	.auth-section-label {
		font-size: 10px;
		font-weight: 650;
		text-transform: uppercase;
		letter-spacing: 0.09em;
		color: var(--text-tertiary);
	}

	.auth-scope-list {
		display: grid;
		overflow: hidden;
		border: 1px solid var(--border-subtle);
		border-radius: 10px;
		background: var(--bg-elevated);
	}

	.auth-scope-row {
		display: grid;
		grid-template-columns: 18px minmax(0, 1fr);
		gap: 11px;
		padding: 12px;
		background: var(--bg-elevated);
	}

	.auth-scope-row + .auth-scope-row {
		border-top: 1px solid var(--border-subtle);
	}

	.auth-scope-check {
		display: inline-flex;
		width: 18px;
		height: 18px;
		align-items: center;
		justify-content: center;
		border-radius: 999px;
		background: var(--brand);
		color: var(--brand-contrast-fg);
		flex: 0 0 auto;
		margin-top: 1px;
		box-shadow: 0 0 0 1px color-mix(in srgb, var(--brand) 24%, transparent);
	}

	.auth-scope-name {
		font-size: 12.5px;
		font-weight: 650;
		line-height: 1.25;
		color: var(--text-primary);
	}

	.auth-scope-description {
		margin-top: 3px;
		font-size: 12px;
		line-height: 1.45;
		color: var(--text-secondary);
	}

	.auth-error {
		display: flex;
		align-items: center;
		gap: 7px;
		border-radius: 8px;
		border: 1px solid color-mix(in srgb, var(--error-soft) 28%, transparent);
		background: var(--error-bg);
		padding: 9px 10px;
		font-size: 12px;
		line-height: 1.35;
		color: var(--error-soft);
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

		.auth-scope-row {
			padding: 11px;
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
