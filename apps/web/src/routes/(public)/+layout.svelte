<script lang="ts">
import "../../app.css";

const { children } = $props();
</script>

<div class="min-h-screen bg-bg-primary text-text-primary">
	{@render children?.()}
</div>
