<script lang="ts">
import { ArrowUp, LoaderCircle, Square } from "lucide-svelte";

const {
	label,
	disabled = false,
	loading = false,
	stop = false,
	buttonType = "submit",
	onclick,
}: {
	label: string;
	disabled?: boolean;
	loading?: boolean;
	stop?: boolean;
	buttonType?: "button" | "submit";
	onclick?: () => void;
} = $props();
</script>

<button
	type={stop ? "button" : buttonType}
	{disabled}
	class={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-all hover:scale-[1.02] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand/40 disabled:scale-100 disabled:cursor-not-allowed disabled:bg-bg-hover-strong disabled:text-text-disabled ${stop ? "bg-text-primary text-bg-primary hover:bg-text-secondary" : "bg-brand text-brand-contrast-fg hover:bg-brand-hover"}`}
	title={label}
	aria-label={label}
	{onclick}
>
	{#if loading}
		<LoaderCircle class="h-4 w-4 animate-spin" />
	{:else if stop}
		<Square class="h-3.5 w-3.5 fill-current" />
	{:else}
		<ArrowUp class="h-4 w-4" />
	{/if}
</button>
