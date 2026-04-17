<script lang="ts">
import { goto } from "$app/navigation";
import { page } from "$app/state";
import { onMount } from "svelte";

onMount(() => {
  const query = page.url.searchParams.toString();
  void goto(`/spaces/${page.params.id}${query ? `?${query}` : ""}`, { replaceState: true });
});
</script>
