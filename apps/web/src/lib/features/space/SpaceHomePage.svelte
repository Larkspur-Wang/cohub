<script lang="ts">
import type { SpaceRecord } from "@neta-art/cohub";
import { BookOpen, FileText, Loader2, Settings } from "lucide-svelte";
import MarkdownView from "$lib/components/MarkdownView.svelte";
import SpaceAvatar from "$lib/components/SpaceAvatar.svelte";
import { sdk } from "$lib/sdk";
import { prepareReadmeMarkdown } from "$lib/space-readme-media";

type SpaceHomeTab = "overview" | "readme";

type Props = {
	spaceId: string;
	space: SpaceRecord | null;
	activeTab: SpaceHomeTab;
	canEditSpace: boolean;
	canCreateSession: boolean;
	onTabChange: (tab: SpaceHomeTab) => void;
	onCreateSession: () => void;
};

let {
	spaceId,
	space,
	activeTab,
	canEditSpace,
	canCreateSession,
	onTabChange,
	onCreateSession,
}: Props = $props();
const readmePath = $derived(
	space?.publicProfile?.landing?.readmePath || "README.md",
);

let readmeLoading = $state(false);
let readmeError = $state("");
let readmeContent = $state("");
let resolvedReadmePath = $state("");
let readmeLoadKey = "";

const preparedReadme = $derived(
	readmeContent
		? prepareReadmeMarkdown({
				markdown: readmeContent,
				spaceId,
				readmePath: resolvedReadmePath || readmePath,
			})
		: "",
);

const tabs: { id: SpaceHomeTab; label: string }[] = [
	{ id: "overview", label: "Overview" },
	{ id: "readme", label: "README" },
];

async function loadReadme() {
	const candidates = [
		...new Set([readmePath, "README.md", "readme.md", "README.markdown"]),
	].filter(Boolean);
	readmeLoading = true;
	readmeError = "";
	readmeContent = "";
	resolvedReadmePath = "";
	try {
		for (const candidate of candidates) {
			try {
				const response = await sdk.space(spaceId).files.read(candidate);
				if ("content" in response && response.kind === "text") {
					readmeContent = response.content;
					resolvedReadmePath = response.path || candidate;
					return;
				}
			} catch {
				// Try the next conventional README path.
			}
		}
		readmeError = "README.md was not found.";
	} finally {
		readmeLoading = false;
	}
}

$effect(() => {
	if (activeTab !== "readme") return;
	const key = `${spaceId}:${readmePath}`;
	if (key === readmeLoadKey) return;
	readmeLoadKey = key;
	void loadReadme();
});
</script>

<div class="flex-1 min-h-0 overflow-y-auto bg-bg-content">
	<div class="mx-auto w-full max-w-5xl px-4 py-5 sm:px-6 lg:px-8">
		<section class="rounded-[12px] border border-border-subtle bg-bg-surface p-4 sm:p-5">
			<div class="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
				<div class="flex min-w-0 gap-3">
					<SpaceAvatar name={space?.name || space?.title || spaceId} profile={space?.publicProfile} size="lg" />
					<div class="min-w-0">
						<h1 class="truncate text-[20px] font-semibold tracking-tight text-text-primary sm:text-[24px]">{space?.name || space?.title || spaceId}</h1>
						{#if space?.description}
							<p class="mt-1 max-w-2xl whitespace-pre-wrap text-[13px] leading-6 text-text-secondary">{space.description}</p>
						{:else}
							<p class="mt-1 text-[13px] text-text-tertiary">A Cohub space for agents, files, and shared work.</p>
						{/if}
					</div>
				</div>
				<div class="flex shrink-0 flex-wrap items-center gap-2">
					{#if canCreateSession}
						<button type="button" class="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-[6px] bg-brand px-3 py-2 text-[12px] font-medium text-brand-contrast-fg transition-colors hover:bg-brand-hover" onclick={onCreateSession}>Start chat</button>
					{/if}
					{#if canEditSpace}
						<a href={`/spaces/${spaceId}/settings`} class="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-[6px] border border-border-subtle bg-bg-input px-3 py-2 text-[12px] font-medium text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary"><Settings class="h-3.5 w-3.5" /> Settings</a>
					{/if}
				</div>
			</div>
		</section>

		<div class="sticky top-0 z-10 mt-4 border-b border-border-subtle bg-bg-content/95 backdrop-blur supports-[backdrop-filter]:bg-bg-content/80">
			<div class="flex gap-1 overflow-x-auto py-2">
				{#each tabs as tab (tab.id)}
					<button
						type="button"
						class="relative min-h-9 shrink-0 rounded-[6px] px-3 text-[13px] font-medium transition-colors {activeTab === tab.id ? 'bg-bg-hover-strong text-text-primary' : 'text-text-tertiary hover:bg-bg-hover hover:text-text-secondary'}"
						onclick={() => onTabChange(tab.id)}
					>
						{tab.label}
					</button>
				{/each}
			</div>
		</div>

		<div class="py-5">
			{#if activeTab === "readme"}
				<section class="overflow-hidden rounded-[12px] border border-border-subtle bg-bg-surface">
					<div class="flex items-center justify-between gap-3 border-b border-border-subtle px-4 py-3 sm:px-5">
						<div class="flex min-w-0 items-center gap-2 text-[13px] font-medium text-text-primary"><BookOpen class="h-4 w-4 text-text-tertiary" /> <span class="truncate">{resolvedReadmePath || readmePath}</span></div>
					</div>
					<div class="p-4 sm:p-6">
						{#if readmeLoading}
							<div class="flex items-center gap-2 py-10 text-[13px] text-text-tertiary"><Loader2 class="h-4 w-4 animate-spin" /> Loading README…</div>
						{:else if preparedReadme}
							<div class="space-readme-document">
								<MarkdownView source={preparedReadme} variant="document" />
							</div>
						{:else}
							<div class="rounded-[10px] border border-border-subtle bg-bg-primary p-6 text-center">
								<FileText class="mx-auto h-8 w-8 text-text-placeholder" />
								<div class="mt-3 text-[14px] font-medium text-text-primary">README not found</div>
								<p class="mx-auto mt-1 max-w-md text-[12px] leading-5 text-text-tertiary">{readmeError || `Create ${readmePath} to introduce this space.`}</p>
							</div>
						{/if}
					</div>
				</section>
			{:else}
				<section class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
					<button type="button" onclick={onCreateSession} disabled={!canCreateSession} class="rounded-[10px] border border-border-subtle bg-bg-surface p-4 text-left transition-colors hover:bg-bg-hover disabled:cursor-not-allowed disabled:opacity-50">
						<MessageSquareIcon />
						<div class="mt-3 text-[14px] font-medium text-text-primary">Start a chat</div>
						<p class="mt-1 text-[12px] leading-5 text-text-tertiary">Create a new session in this space.</p>
					</button>
					<a href={`/spaces/${spaceId}/checkpoints`} class="rounded-[10px] border border-border-subtle bg-bg-surface p-4 transition-colors hover:bg-bg-hover">
						<div class="text-[14px] font-medium text-text-primary">Checkpoints</div>
						<p class="mt-1 text-[12px] leading-5 text-text-tertiary">Browse saved versions and fork from stable states.</p>
					</a>
					<a href={`/spaces/${spaceId}/files`} class="rounded-[10px] border border-border-subtle bg-bg-surface p-4 transition-colors hover:bg-bg-hover">
						<div class="text-[14px] font-medium text-text-primary">Files</div>
						<p class="mt-1 text-[12px] leading-5 text-text-tertiary">Explore workspace files and assets.</p>
					</a>
				</section>
			{/if}
		</div>
	</div>
</div>

{#snippet MessageSquareIcon()}
	<svg class="h-5 w-5 text-text-tertiary" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z" /></svg>
{/snippet}

<style>
	.space-readme-document :global(video) {
		width: 100%;
		max-height: min(70vh, 720px);
		border-radius: 10px;
		background: #000;
	}
</style>
