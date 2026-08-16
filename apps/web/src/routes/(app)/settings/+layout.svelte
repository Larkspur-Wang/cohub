<script lang="ts">
import { Menu } from "lucide-svelte";
import { page } from "$app/state";
import { uiState } from "$lib/stores/ui.svelte";

const settingsTitles: Record<string, string> = {
	profile: "Profile",
	activity: "Activity",
	appearance: "Appearance",
	referrals: "Referrals",
	billing: "Billing",
	balance: "Billing",
	rules: "User Rules",
	channels: "Channels",
};

const currentSection = $derived(
	page.url.pathname.split("/").filter(Boolean)[1] ?? "profile",
);
const title = $derived(settingsTitles[currentSection] ?? "Settings");

const { children } = $props();
</script>

<div class="flex min-h-0 flex-1 flex-col overflow-hidden">
	<header class="flex h-11 shrink-0 items-center border-b border-border-subtle bg-bg-primary px-2 lg:hidden">
		<button
			type="button"
			class="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[6px] text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/35"
			aria-label="Open settings navigation"
			title="Open settings navigation"
			onclick={() => {
				uiState.mobileDrawerOpen = true;
			}}
		>
			<Menu class="h-[18px] w-[18px]" />
		</button>
		<div class="min-w-0 flex-1 truncate px-2 text-[13px] font-medium text-text-primary">{title}</div>
	</header>

	{@render children?.()}
</div>
