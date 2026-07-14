<script lang="ts">
import UserSessionsPage from "$lib/features/sessions/UserSessionsPage.svelte";

const { data } = $props();
</script>

<UserSessionsPage {data} />
