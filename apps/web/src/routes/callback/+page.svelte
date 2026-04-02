<script lang="ts">
  import { goto } from "$app/navigation";
  import { logtoClient } from "$lib/auth";
  import { onMount } from "svelte";

  onMount(() => {
    logtoClient.handleSignInCallback(window.location.href).then(() => {
      goto("/");
    });
  });
</script>
