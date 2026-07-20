<script lang="ts">
import "../../app.css";

const { children } = $props();
</script>

<div class="min-h-screen overflow-x-hidden bg-bg-primary text-text-primary">
	{@render children?.()}
</div>
