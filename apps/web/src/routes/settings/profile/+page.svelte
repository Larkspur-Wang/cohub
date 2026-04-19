<script lang="ts">
import { User, Copy, Check } from "lucide-svelte";
import { getMe } from "$lib/api";
import { onMount } from "svelte";
import { ensureAuth, logtoClient } from "$lib/auth";

let userUuid = $state("");
let userNickname = $state("");
let userAvatar = $state("");
let uuidCopied = $state(false);
let loadError = $state("");
let uuidCopiedTimer: ReturnType<typeof setTimeout> | null = null;

async function loadProfile() {
  if (!(await ensureAuth())) return;
  try {
    const me = await getMe();
    userUuid = me.uuid ?? "";
    userNickname = me.nick_name ?? "";
    userAvatar = me.avatar_url ?? "";
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load profile";
    if (message.includes("unauthorized") || message.includes("401")) {
      await logtoClient.signIn(`${window.location.origin}/callback`);
      return;
    }
    loadError = message;
    console.error("[profile] Failed to load profile:", error);
  }
}

async function copyUuid() {
  if (!userUuid) return;
  try {
    await navigator.clipboard.writeText(userUuid);
    uuidCopied = true;
    if (uuidCopiedTimer) clearTimeout(uuidCopiedTimer);
    uuidCopiedTimer = setTimeout(() => { uuidCopied = false; }, 2000);
  } catch {
    console.warn("[profile] Failed to copy UUID");
  }
}

onMount(() => {
  void loadProfile();
});
</script>

<div class="flex-1 flex flex-col min-h-0 overflow-y-auto">
  <div class="flex-1 p-6 overflow-y-auto">
    <section class="max-w-xl">
      <h1 class="text-[18px] font-semibold text-text-primary tracking-tight">Profile</h1>
      <p class="mt-1 text-[13px] text-text-tertiary">
        Your user identity. Share your UUID to be added as a collaborator on shared spaces.
      </p>

      {#if loadError}
        <div class="mt-6 rounded-md border border-error-soft/30 bg-error-bg p-3 text-[12px] font-mono text-error-soft break-all">{loadError}</div>
      {:else if userUuid}
        <div class="mt-6 border border-border-subtle rounded-md bg-bg-surface p-4 space-y-3">
        {#if userAvatar}
          <div class="flex items-center gap-3">
            <img src={userAvatar} alt="avatar" class="w-9 h-9 rounded-full border border-border-subtle" />
            <span class="text-[14px] font-medium text-text-primary">{userNickname || "User"}</span>
          </div>
        {:else}
          <div class="flex items-center gap-3">
            <div class="w-9 h-9 rounded-full bg-bg-hover-strong border border-border-subtle flex items-center justify-center">
              <User class="w-4 h-4 text-text-tertiary" />
            </div>
            <span class="text-[14px] font-medium text-text-primary">{userNickname || "User"}</span>
          </div>
        {/if}

        <div>
          <div class="block text-[10px] font-medium uppercase tracking-wider text-text-tertiary mb-1.5">User UUID</div>
          <div class="flex items-center gap-2">
            <code class="flex-1 px-3 py-[6px] rounded-[5px] bg-bg-code border border-border-subtle text-[12px] font-mono text-text-primary truncate select-all">{userUuid}</code>
            <button
              type="button"
              onclick={copyUuid}
              class="shrink-0 p-2 rounded-[5px] border border-border-subtle bg-bg-hover hover:bg-bg-hover-strong text-text-tertiary hover:text-text-secondary transition-colors cursor-pointer"
              title="Copy UUID"
            >
              {#if uuidCopied}
                <Check class="w-4 h-4 text-status-running" />
              {:else}
                <Copy class="w-4 h-4" />
              {/if}
            </button>
          </div>
        </div>
      </div>
      {/if}
    </section>
  </div>
</div>
