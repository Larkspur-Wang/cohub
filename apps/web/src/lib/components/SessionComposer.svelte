<script lang="ts">
import { ArrowUp } from "lucide-svelte";

type Props = {
	value: string;
	disabled?: boolean;
	streamError?: string;
	onsubmit: () => void;
};

let {
	value = $bindable(""),
	disabled = false,
	streamError = "",
	onsubmit,
}: Props = $props();
</script>

<div class="px-4 pb-3 pt-1">
	{#if streamError}
		<div class="mb-2 mx-auto max-w-3xl rounded-lg border border-rose-500/20 bg-rose-500/8 px-3 py-2 text-[11px] text-rose-400">{streamError}</div>
	{/if}

	<form
		class="mx-auto max-w-3xl flex items-end gap-2"
		onsubmit={(event) => {
			event.preventDefault();
			onsubmit();
		}}
	>
		<textarea
			bind:value
			rows="1"
			placeholder="Message session..."
			class="min-h-[44px] max-h-[160px] flex-1 resize-none rounded-2xl bg-bg-surface/40 px-4 py-2.5 text-[14px] leading-[1.6] text-text-primary outline-none transition-colors placeholder:text-text-placeholder focus:bg-bg-surface/60 focus:ring-1 focus:ring-brand/10"
			onkeydown={(event) => {
				if (event.key === 'Enter' && !event.shiftKey) {
					event.preventDefault();
					if (!disabled && value.trim()) {
						onsubmit();
					}
				}
			}}
		></textarea>
		<button
			type="submit"
			disabled={disabled || !value.trim()}
			class="h-[44px] w-[44px] shrink-0 rounded-full flex items-center justify-center bg-brand/80 text-white transition-colors hover:bg-brand disabled:cursor-not-allowed disabled:opacity-25 disabled:hover:bg-brand/80"
		>
			<ArrowUp class="w-[18px] h-[18px]" />
		</button>
	</form>
</div>
