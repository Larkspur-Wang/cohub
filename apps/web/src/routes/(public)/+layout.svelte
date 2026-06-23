<script lang="ts">
import "../../app.css";

const { children } = $props();
</script>

<main class="min-h-screen bg-bg-primary text-text-primary">
	{@render children?.()}
</main>
