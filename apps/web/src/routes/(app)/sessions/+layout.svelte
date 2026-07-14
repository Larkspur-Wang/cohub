<script lang="ts">
/**
 * Shared shell for /sessions, /sessions/new, /sessions/:id.
 * Keeps UserSessionsPage mounted across child navigations so the left list
 * does not remount (and jump) when opening/changing a new-chat draft.
 */
import { page } from "$app/state";
import UserSessionsPage from "$lib/features/sessions/UserSessionsPage.svelte";

// Child +page loads supply sessionId / isNew / spaceId; layout owns the UI.
const data = $derived({
	sessionId: (page.data.sessionId as string | null | undefined) ?? null,
	turnSequence: (page.data.turnSequence as string | null | undefined) ?? null,
	isNew: Boolean(page.data.isNew),
	spaceId: (page.data.spaceId as string | null | undefined) ?? null,
});
</script>

<UserSessionsPage {data} />
