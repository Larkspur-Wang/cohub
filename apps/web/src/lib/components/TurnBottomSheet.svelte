<script lang="ts">
import type { SessionTurnIndexItem } from "@cohub/protocol/model";

type Props = {
	open: boolean;
	turns: SessionTurnIndexItem[];
	currentSequence?: number | null;
	onClose?: () => void;
	onJump?: (sequence: number) => void;
};

let { open, turns, currentSequence = null, onClose, onJump }: Props = $props();

function jump(sequence: number) {
	onJump?.(sequence);
	onClose?.();
}

function statusTone(status: SessionTurnIndexItem["status"]) {
	if (status === "failed") return "text-error-soft";
	if (status === "running") return "text-info-soft";
	if (status === "interrupted") return "text-warning-soft";
	return "text-text-tertiary";
}
</script>

{#if open}
	<div class="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Turn navigator">
		<button class="absolute inset-0 h-full w-full bg-overlay-scrim" aria-label="Close turn navigator" onclick={onClose}></button>
		<div class="absolute inset-x-0 bottom-0 max-h-[72vh] rounded-t-2xl border-t border-border-subtle bg-bg-primary shadow-[0_-12px_36px_rgba(0,0,0,0.28)]">
			<div class="mx-auto mt-2.5 h-1 w-9 rounded-full bg-border-subtle"></div>
			<div class="max-h-[66vh] overflow-y-auto pb-2 pt-2">
				{#each turns as turn (`${turn.sequence}:${turn.id}`)}
					<button
						type="button"
						class={`flex w-full items-start gap-3 px-4 py-3 text-left transition-colors ${turn.sequence === currentSequence ? 'bg-brand/10' : 'active:bg-bg-hover'}`}
						onclick={() => jump(turn.sequence)}
					>
						<div class={`mt-0.5 w-10 shrink-0 text-[11px] font-medium tabular-nums ${turn.sequence === currentSequence ? 'text-brand' : 'text-text-tertiary'}`}>#{turn.sequence}</div>
						<div class="min-w-0 flex-1">
							<div class="line-clamp-2 text-[13px] leading-relaxed text-text-primary">
								{turn.userPreview ?? "Empty user message"}
							</div>
							<div class={`mt-1 text-[11px] ${statusTone(turn.status)}`}>{turn.status}{turn.model ? ` · ${turn.model}` : ''}</div>
						</div>
					</button>
				{/each}
			</div>
		</div>
	</div>
{/if}
