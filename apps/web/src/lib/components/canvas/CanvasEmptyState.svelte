<script lang="ts">
import { Plus } from "lucide-svelte";
</script>

<div class="pointer-events-none absolute inset-0 flex items-center justify-center p-6">
	<div class="flex flex-col items-center gap-2 text-center">
		<div class="flex h-10 w-10 items-center justify-center rounded-xl border border-border-subtle bg-bg-surface text-text-tertiary">
			<Plus class="h-4 w-4" />
		</div>
		<div class="text-sm font-medium text-text-secondary">Start your canvas</div>
		<div class="max-w-[240px] text-xs leading-5 text-text-tertiary">
			Drop files from the tree, double-click to add a note, or use
			<span class="text-text-secondary">+</span> below.
		</div>
	</div>
</div>
