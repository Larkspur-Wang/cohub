<script lang="ts">
import { onDestroy } from "svelte";
import "../../app.css";
import { getResolvedTheme } from "$lib/theme.svelte";

const { children } = $props();

// Public pages are always dark, regardless of the visitor's saved theme.
// Set the attribute at layout init — before any public page paints — so
// there is no light-theme flash. The app.html FOUC script may have set the
// visitor's preference; we override it here for the public view only.
document.documentElement.setAttribute("data-theme", "dark");

/** Restore the visitor's real theme when leaving the public group,
 * so a light-preferring visitor isn't stuck on dark in the app shell. */
onDestroy(() => {
	document.documentElement.setAttribute("data-theme", getResolvedTheme());
});
</script>

<main class="min-h-screen bg-bg-primary text-text-primary">
	{@render children?.()}
</main>
