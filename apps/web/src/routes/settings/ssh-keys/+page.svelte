<script lang="ts">
import { KeyRound } from "lucide-svelte";
</script>

<svelte:head>
	<title>SSH keys — Cohub</title>
</svelte:head>

<div class="flex-1 flex flex-col min-h-0 overflow-y-auto">
	<div class="flex-1 p-6 overflow-y-auto">
		<section class="max-w-xl">
			<h1 class="text-[18px] font-semibold text-text-primary tracking-tight">SSH Keys</h1>
			<p class="mt-1 text-[13px] text-text-tertiary">
				Git repository access is now managed internally by Cohub checkpoints, so SSH key management is currently unavailable.
			</p>

			<div class="mt-6 rounded-md border border-border-subtle bg-bg-surface p-6 text-center">
				<div class="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-bg-hover">
					<KeyRound class="h-5 w-5 text-text-placeholder" />
				</div>
				<p class="text-[14px] text-text-secondary">SSH key management has been disabled.</p>
				<p class="mt-1 text-[12px] text-text-placeholder">
					Use the built-in checkpoint flow to save and restore space contents.
				</p>
			</div>
		</section>
	</div>
</div>
