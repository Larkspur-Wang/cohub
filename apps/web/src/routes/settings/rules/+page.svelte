<script lang="ts">
import {
	Check,
	Loader2,
	RotateCcw,
	Save,
	ShieldAlert,
	Trash2,
} from "lucide-svelte";
import { onMount } from "svelte";
import { page } from "$app/state";
import { ensureAuth } from "$lib/auth";
import { handleUnauthorizedError } from "$lib/auth-redirect";
import { sdk } from "$lib/sdk";

const MAX_BYTES = 32 * 1024;
const defaultTemplate = `## Working style

- Read relevant files before making changes
- Share a plan before risky or complex work
- Validate changes with typecheck, lint, and relevant tests

## Code preferences

- Keep solutions simple, lightweight, and extensible
- Prefer reusable components and shared utilities for repeated patterns
- Fix lint issues instead of ignoring them
`;

const currentPath = $derived(page.url.pathname);
const currentSearch = $derived(page.url.search);

let content = $state("");
let savedContent = $state("");
let updatedAt = $state<string | null>(null);
let isLoading = $state(true);
let isSaving = $state(false);
let isDeleting = $state(false);
let loadError = $state("");
let saveMessage = $state("");

const byteCount = $derived(new TextEncoder().encode(content).byteLength);
const isTooLarge = $derived(byteCount > MAX_BYTES);
const isDirty = $derived(content !== savedContent);
const canSave = $derived(!isLoading && !isSaving && isDirty && !isTooLarge);

function formatUpdatedAt(value: string | null) {
	if (!value) return "Not saved yet";
	try {
		return new Intl.DateTimeFormat(undefined, {
			dateStyle: "medium",
			timeStyle: "short",
		}).format(new Date(value));
	} catch {
		return value;
	}
}

async function loadRules() {
	if (!(await ensureAuth({ redirectPath: `${currentPath}${currentSearch}` })))
		return;
	isLoading = true;
	loadError = "";
	saveMessage = "";
	try {
		const rules = await sdk.user.getRules();
		content = rules.content;
		savedContent = rules.content;
		updatedAt = rules.updatedAt;
	} catch (error) {
		if (
			await handleUnauthorizedError(error, `${currentPath}${currentSearch}`)
		) {
			return;
		}
		loadError =
			error instanceof Error ? error.message : "Failed to load user rules";
	} finally {
		isLoading = false;
	}
}

async function saveRules() {
	if (!canSave) return;
	isSaving = true;
	saveMessage = "";
	try {
		const rules = await sdk.user.updateRules(content);
		content = rules.content;
		savedContent = rules.content;
		updatedAt = rules.updatedAt;
		saveMessage = "Saved";
	} catch (error) {
		if (
			await handleUnauthorizedError(error, `${currentPath}${currentSearch}`)
		) {
			return;
		}
		saveMessage =
			error instanceof Error ? error.message : "Failed to save user rules";
	} finally {
		isSaving = false;
	}
}

async function deleteRules() {
	if (!content && !savedContent) return;
	if (!confirm("Clear your user rules? New chats will stop receiving them."))
		return;
	isDeleting = true;
	saveMessage = "";
	try {
		await sdk.user.deleteRules();
		content = "";
		savedContent = "";
		updatedAt = null;
		saveMessage = "Cleared";
	} catch (error) {
		if (
			await handleUnauthorizedError(error, `${currentPath}${currentSearch}`)
		) {
			return;
		}
		saveMessage =
			error instanceof Error ? error.message : "Failed to clear user rules";
	} finally {
		isDeleting = false;
	}
}

function insertTemplate() {
	if (
		content.trim() &&
		!confirm("Replace the current editor content with the template?")
	)
		return;
	content = defaultTemplate;
	saveMessage = "";
}

onMount(() => {
	void loadRules();
});
</script>

<div class="flex-1 flex flex-col min-h-0 overflow-y-auto">
  <div class="flex-1 p-6 overflow-y-auto">
    <section class="max-w-3xl">
      <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 class="text-[18px] font-semibold text-text-primary tracking-tight">User Rules</h1>
          <p class="mt-1 text-[13px] text-text-tertiary max-w-2xl">
            These Markdown instructions are automatically included in every chat you start. Use them for working style, coding preferences, review standards, and communication preferences.
          </p>
        </div>
        <div class="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onclick={insertTemplate}
            class="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-[5px] border border-border-subtle bg-bg-surface text-[12px] text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors disabled:opacity-50"
            disabled={isLoading || isSaving || isDeleting}
          >
            <RotateCcw class="w-3.5 h-3.5" />
            Template
          </button>
          <button
            type="button"
            onclick={deleteRules}
            class="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-[5px] border border-error-soft/25 bg-error-bg text-[12px] text-error-soft hover:bg-error-bg/80 transition-colors disabled:opacity-50"
            disabled={isLoading || isSaving || isDeleting || (!content && !savedContent)}
          >
            {#if isDeleting}
              <Loader2 class="w-3.5 h-3.5 animate-spin" />
            {:else}
              <Trash2 class="w-3.5 h-3.5" />
            {/if}
            Clear
          </button>
          <button
            type="button"
            onclick={saveRules}
            class="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-[5px] bg-[#FF3E00]/10 border border-[#FF3E00]/20 text-brand text-[12px] font-medium hover:bg-[#FF3E00]/15 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            disabled={!canSave}
          >
            {#if isSaving}
              <Loader2 class="w-3.5 h-3.5 animate-spin" />
            {:else if saveMessage === "Saved"}
              <Check class="w-3.5 h-3.5" />
            {:else}
              <Save class="w-3.5 h-3.5" />
            {/if}
            Save
          </button>
        </div>
      </div>

      <div class="mt-5 rounded-md border border-amber-500/20 bg-amber-500/5 p-3 flex gap-2.5">
        <ShieldAlert class="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
        <p class="text-[12px] leading-5 text-text-tertiary">
          Do not put tokens, passwords, private keys, or sensitive personal data here. These rules are sent to the model as part of the system context.
        </p>
      </div>

      {#if loadError}
        <div class="mt-6 rounded-md border border-error-soft/30 bg-error-bg p-3 text-[12px] font-mono text-error-soft break-all">{loadError}</div>
      {:else if isLoading}
        <div class="flex items-center justify-center py-12 text-[12px] text-text-tertiary">
          <Loader2 class="w-4 h-4 animate-spin mr-2" />
          Loading user rules...
        </div>
      {:else}
        <div class="mt-6 space-y-2">
          <textarea
            bind:value={content}
            spellcheck="false"
            class="w-full min-h-[420px] resize-y rounded-md border border-border-subtle bg-bg-surface px-3 py-3 font-mono text-[12px] leading-5 text-text-primary outline-none focus:border-brand/40 focus:ring-2 focus:ring-brand/10 placeholder:text-text-placeholder"
            placeholder="Add your personal rules in Markdown..."
          ></textarea>
          <div class="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between text-[11px]">
            <div class="text-text-tertiary">
              Updated: {formatUpdatedAt(updatedAt)}{#if isDirty}<span class="text-brand"> · Unsaved changes</span>{/if}
            </div>
            <div class={isTooLarge ? "text-error-soft" : "text-text-tertiary"}>
              {byteCount.toLocaleString()} / {MAX_BYTES.toLocaleString()} bytes
            </div>
          </div>
          {#if saveMessage}
            <div class={saveMessage === "Saved" || saveMessage === "Cleared" ? "text-[12px] text-status-running" : "text-[12px] text-error-soft"}>{saveMessage}</div>
          {/if}
        </div>
      {/if}
    </section>
  </div>
</div>
