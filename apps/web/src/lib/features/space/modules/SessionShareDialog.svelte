<script lang="ts">
import { Check, Copy, Globe, Loader2, Lock, Share2 } from "lucide-svelte";
import Dialog from "$lib/components/Dialog.svelte";

type Props = {
	open: boolean;
	isPublic: boolean;
	saving: boolean;
	copied: boolean;
	error: string;
	onClose: () => void;
	onRemovePermission: () => void | Promise<void>;
	onMakePrivate: () => void | Promise<void>;
	onCopyLink: () => void | Promise<void>;
	onShare: () => void | Promise<void>;
};

let {
	open,
	isPublic,
	saving,
	copied,
	error,
	onClose,
	onRemovePermission,
	onMakePrivate,
	onCopyLink,
	onShare,
}: Props = $props();
</script>

<Dialog {open} {onClose} title={isPublic ? "Session is public" : "Share session"} maxWidth="380px">
	<div class="space-y-4 p-4">
		{#if isPublic}
			<p class="text-[13px] leading-relaxed text-text-secondary">Anyone with the link can view this session. Choose how to manage access:</p>
			<div class="space-y-2">
				<button
					type="button"
					class="flex w-full items-start gap-3 rounded-[6px] border border-border-subtle bg-bg-surface px-3 py-2.5 text-left transition-colors hover:bg-bg-hover disabled:opacity-50"
					onclick={() => void onRemovePermission()}
					disabled={saving}
				>
					<Globe class="mt-0.5 h-4 w-4 shrink-0 text-text-tertiary" />
					<div class="min-w-0">
						<div class="text-[13px] font-medium text-text-primary">Remove permission</div>
						<div class="mt-0.5 text-[11px] leading-relaxed text-text-placeholder">Delete this session's access rule.</div>
					</div>
				</button>
				<button
					type="button"
					class="flex w-full items-start gap-3 rounded-[6px] border border-border-subtle bg-bg-surface px-3 py-2.5 text-left transition-colors hover:bg-bg-hover disabled:opacity-50"
					onclick={() => void onMakePrivate()}
					disabled={saving}
				>
					<Lock class="mt-0.5 h-4 w-4 shrink-0 text-text-tertiary" />
					<div class="min-w-0">
						<div class="text-[13px] font-medium text-text-primary">Make private</div>
						<div class="mt-0.5 text-[11px] leading-relaxed text-text-placeholder">Block all external access.</div>
					</div>
				</button>
			</div>
			<button
				type="button"
				class="flex w-full items-center justify-center gap-2 rounded-[5px] border border-border-subtle px-3 py-2 text-[13px] text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary disabled:opacity-50"
				onclick={() => void onCopyLink()}
				disabled={saving}
			>
				{#if copied}
					<Check class="h-3.5 w-3.5 text-status-success" />
					Copied
				{:else}
					<Copy class="h-3.5 w-3.5" />
					Copy link
				{/if}
			</button>
		{:else}
			<p class="text-[13px] leading-relaxed text-text-secondary">This session will become publicly accessible. Anyone with the link can view the conversation.</p>
			<button
				type="button"
				class="flex w-full items-center justify-center gap-2 rounded-[5px] border border-border-subtle bg-bg-primary px-3 py-2.5 text-[13px] font-medium text-text-primary transition-colors hover:bg-bg-hover-strong disabled:opacity-50"
				onclick={() => void onShare()}
				disabled={saving}
			>
				{#if saving}
					<Loader2 class="h-3.5 w-3.5 animate-spin" />
					Sharing…
				{:else}
					<Share2 class="h-3.5 w-3.5" />
					Share &amp; copy link
				{/if}
			</button>
		{/if}
		{#if error}
			<div class="break-all text-[12px] text-error-soft">{error}</div>
		{/if}
	</div>
</Dialog>
