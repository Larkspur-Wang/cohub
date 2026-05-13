<script lang="ts">
import type { PromptTemplateCatalogEntry } from "@neta-art/cohub";
import {
	ArrowUp,
	ChevronDown,
	Maximize2,
	Minimize2,
	Plus,
	Square,
	Upload,
	X,
} from "lucide-svelte";
import { onMount } from "svelte";
import SlashCommandMenu, {
	type SlashCommandMenuItem,
} from "$lib/components/SlashCommandMenu.svelte";
import {
	COMPOSER_ATTACHMENT_ACCEPT,
	type ComposerAttachment,
	isSupportedComposerAttachmentFile,
} from "$lib/composer-attachments";

type SelectedModel = {
	provider: string;
	id: string;
	name?: string;
};

type Props = {
	value: string;
	disabled?: boolean;
	sending?: boolean;
	isRunning?: boolean;
	aborting?: boolean;
	streamError?: string;
	placeholder?: string;
	attachments?: ComposerAttachment[];
	currentModel?: SelectedModel | null;
	promptTemplates?: PromptTemplateCatalogEntry[];
	promptTemplatesLoaded?: boolean;
	onsubmit: () => void;
	onabort?: () => void;
	onpickattachment?: (files: FileList | File[] | null) => void;
	onremoveattachment?: (id: string) => void;
	onModelSelect?: () => void;
};

let {
	value = $bindable(""),
	disabled = false,
	sending = false,
	isRunning = false,
	aborting = false,
	streamError = "",
	placeholder = "Send a message...",
	attachments = [],
	currentModel = null,
	promptTemplates = [],
	promptTemplatesLoaded = true,
	onsubmit,
	onabort,
	onpickattachment,
	onremoveattachment,
	onModelSelect,
}: Props = $props();

let textareaEl = $state<HTMLTextAreaElement | null>(null);
let fileInputEl = $state<HTMLInputElement | null>(null);
let isDragOver = $state(false);
let dragCounter = 0;
let isPathDragOver = $state(false);
let showPromptSuggestions = $state(false);
let selectedPromptIndex = $state(0);
let isComposerExpanded = $state(false);

const hasDraft = $derived(Boolean(value.trim() || attachments.length > 0));
const showAbort = $derived(Boolean(isRunning && !hasDraft));
const submitDisabled = $derived(
	disabled || sending || (!hasDraft && !showAbort),
);

const filteredPromptTemplates = $derived.by<SlashCommandMenuItem[]>(() => {
	const trimmed = value.trimStart();
	if (!trimmed.startsWith("/")) return [];
	if (trimmed.includes("\n")) return [];
	const firstToken = trimmed.split(/\s+/, 1)[0] ?? "";
	const query = firstToken.slice(1).toLowerCase();
	const scored: SlashCommandMenuItem[] = [];
	for (const item of promptTemplates) {
		const name = item.name.toLowerCase();
		const description = item.description.toLowerCase();
		const category = item.category?.toLowerCase() ?? "";
		let matchScore = 0;
		if (!query) matchScore = 10;
		else if (name.startsWith(query)) matchScore = 100;
		else if (name.includes(query)) matchScore = 80;
		else if (category.includes(query)) matchScore = 64;
		else if (description.includes(query)) matchScore = 48;
		else continue;
		scored.push({ ...item, matchScore });
	}

	return scored.sort((a, b) => {
		const scoreDelta = (b.matchScore ?? 0) - (a.matchScore ?? 0);
		if (scoreDelta !== 0) return scoreDelta;
		const categoryDelta = (a.category ?? a.scope).localeCompare(
			b.category ?? b.scope,
		);
		if (categoryDelta !== 0) return categoryDelta;
		return a.name.localeCompare(b.name);
	});
});

const slashCommandQuery = $derived.by(() => {
	const trimmed = value.trimStart();
	if (!trimmed.startsWith("/") || trimmed.includes("\n")) return "";
	return (trimmed.split(/\s+/, 1)[0] ?? "").slice(1);
});
const slashCommandActive = $derived.by(() => {
	const trimmed = value.trimStart();
	return trimmed.startsWith("/") && !trimmed.includes("\n");
});
const slashCommandLoading = $derived(
	slashCommandActive && !promptTemplatesLoaded,
);

// Detect mobile/touch — on mobile, Enter should insert newline, not send
function isMobile(): boolean {
	if (typeof window === "undefined") return false;
	return (
		"ontouchstart" in window ||
		window.matchMedia("(pointer: coarse)").matches ||
		navigator.maxTouchPoints > 0
	);
}

function getViewportHeight(): number {
	if (typeof window === "undefined") return 800;
	return window.visualViewport?.height ?? window.innerHeight;
}

function getTextareaLimits() {
	const mobile = isMobile();
	const viewportHeight = getViewportHeight();
	const min = isComposerExpanded ? (mobile ? 160 : 200) : 44;
	const max = isComposerExpanded
		? Math.min(viewportHeight * (mobile ? 0.58 : 0.7), mobile ? 520 : 720)
		: Math.min(viewportHeight * (mobile ? 0.34 : 0.38), mobile ? 220 : 220);

	return {
		min,
		max: Math.max(min, max),
	};
}

function resizeTextarea() {
	if (!textareaEl) return;
	const { min, max } = getTextareaLimits();
	textareaEl.style.height = "0px";
	const nextHeight = isComposerExpanded
		? max
		: Math.min(textareaEl.scrollHeight, max);
	textareaEl.style.height = `${Math.max(nextHeight, min)}px`;
}

function toggleComposerExpanded() {
	isComposerExpanded = !isComposerExpanded;
	requestAnimationFrame(() => {
		textareaEl?.focus();
		resizeTextarea();
	});
}

function applyPromptTemplate(item: SlashCommandMenuItem) {
	const trimmedStart = value.trimStart();
	const leadingWhitespace = value.slice(0, value.length - trimmedStart.length);
	const firstSpace = trimmedStart.indexOf(" ");
	const suffix = firstSpace === -1 ? "" : trimmedStart.slice(firstSpace);
	value = `${leadingWhitespace}/${item.name}${suffix || " "}`;
	showPromptSuggestions = false;
	selectedPromptIndex = 0;
	requestAnimationFrame(() => {
		textareaEl?.focus();
		const pos = value.length;
		textareaEl?.setSelectionRange(pos, pos);
	});
}

function hasAttachmentFiles(dataTransfer: DataTransfer | null) {
	if (!dataTransfer) return false;
	return Array.from(dataTransfer.items ?? []).some((item) => {
		if (item.kind !== "file") return false;
		const file = item.getAsFile();
		if (file) return isSupportedComposerAttachmentFile(file);
		return item.type.startsWith("image/") || item.type.startsWith("text/");
	});
}

function handleDragEnter(event: DragEvent) {
	if (!hasAttachmentFiles(event.dataTransfer)) return;
	event.preventDefault();
	dragCounter += 1;
	isDragOver = true;
}

function handleDragOver(event: DragEvent) {
	if (!hasAttachmentFiles(event.dataTransfer)) return;
	event.preventDefault();
	isDragOver = true;
}

function handleDragLeave(event: DragEvent) {
	if (!hasAttachmentFiles(event.dataTransfer)) return;
	event.preventDefault();
	dragCounter = Math.max(0, dragCounter - 1);
	if (dragCounter === 0) {
		isDragOver = false;
	}
}

function handleDrop(event: DragEvent) {
	if (!hasAttachmentFiles(event.dataTransfer)) return;
	event.preventDefault();
	isDragOver = false;
	dragCounter = 0;
	onpickattachment?.(event.dataTransfer?.files ?? null);
}

function handlePathDragOver(event: DragEvent) {
	if (!event.dataTransfer?.types.includes("text/cohub-path")) return;
	event.preventDefault();
	event.dataTransfer.dropEffect = "copy";
	isPathDragOver = true;
}

function handlePathDragLeave() {
	isPathDragOver = false;
}

function insertSnippet(snippet: string) {
	if (!textareaEl) {
		value = `${value}${snippet}`;
		return;
	}
	const start = textareaEl.selectionStart;
	const end = textareaEl.selectionEnd;
	value = value.slice(0, start) + snippet + value.slice(end);
	requestAnimationFrame(() => {
		const pos = start + snippet.length;
		textareaEl?.setSelectionRange(pos, pos);
		textareaEl?.focus();
		resizeTextarea();
	});
}

function focusComposer() {
	requestAnimationFrame(() => {
		textareaEl?.focus();
	});
}

function handlePathDrop(event: DragEvent) {
	isPathDragOver = false;
	const path = event.dataTransfer?.getData("text/cohub-path");
	if (!path || !textareaEl) return;
	event.preventDefault();
	insertSnippet(` \`${path}\` `);
}

function handlePaste(event: ClipboardEvent) {
	const files = Array.from(event.clipboardData?.items ?? [])
		.filter((item) => item.kind === "file")
		.map((item) => item.getAsFile())
		.filter(
			(file): file is File =>
				file instanceof File && isSupportedComposerAttachmentFile(file),
		);

	if (files.length === 0) return;
	event.preventDefault();
	onpickattachment?.(files);
}

onMount(() => {
	focusComposer();
	const handleComposerInsert = (event: Event) => {
		const custom = event as CustomEvent<{ snippet?: string }>;
		const snippet = custom.detail?.snippet;
		if (!snippet) return;
		insertSnippet(snippet);
	};
	const handleFocusComposer = () => focusComposer();
	const handleViewportResize = () => resizeTextarea();
	window.addEventListener("cohub:composer-focus", handleFocusComposer);
	window.addEventListener("cohub:composer-insert", handleComposerInsert);
	window.addEventListener("resize", handleViewportResize);
	window.visualViewport?.addEventListener("resize", handleViewportResize);
	return () => {
		window.removeEventListener("cohub:composer-focus", handleFocusComposer);
		window.removeEventListener("cohub:composer-insert", handleComposerInsert);
		window.removeEventListener("resize", handleViewportResize);
		window.visualViewport?.removeEventListener("resize", handleViewportResize);
	};
});

$effect(() => {
	value;
	attachments.length;
	isComposerExpanded;
	resizeTextarea();
});

$effect(() => {
	const shouldShow =
		slashCommandActive &&
		(filteredPromptTemplates.length > 0 || slashCommandLoading);
	showPromptSuggestions = shouldShow;
	if (!shouldShow) {
		selectedPromptIndex = 0;
		return;
	}
	selectedPromptIndex = Math.min(
		selectedPromptIndex,
		Math.max(filteredPromptTemplates.length - 1, 0),
	);
});
</script>

<div class="px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-2 sm:px-6 sm:pb-4">
	<div class={`relative mx-auto transition-[max-width] duration-200 ${isComposerExpanded ? 'max-w-5xl' : 'max-w-4xl'}`}>
		{#if streamError}
			<div class="mb-3 rounded-2xl border border-error-soft/25 bg-error-bg px-3 py-2 text-[11px] text-error-soft">
				{streamError}
			</div>
		{/if}

		<form
			class={`relative rounded-[28px] border p-2 shadow-[0_12px_36px_rgba(15,23,42,0.08)] backdrop-blur-md transition-colors ${(isDragOver || isPathDragOver) ? 'border-brand/50 bg-brand/5' : 'border-border-subtle/70 bg-bg-content/92 focus-within:border-brand/25 focus-within:bg-bg-content/96'}`}
			onsubmit={(event) => {
				event.preventDefault();
				if (!submitDisabled && hasDraft) onsubmit();
			}}
			ondragenter={handleDragEnter}
			ondragover={handleDragOver}
			ondragleave={handleDragLeave}
			ondrop={handleDrop}
		>
			{#if isDragOver}
				<div class="pointer-events-none absolute inset-2 z-10 flex items-center justify-center rounded-[24px] border border-dashed border-brand/40 bg-bg-primary/82 backdrop-blur-sm">
					<div class="flex items-center gap-2 rounded-full border border-border-subtle bg-bg-elevated px-4 py-2 text-[12px] text-text-secondary">
						<Upload class="h-4 w-4 text-brand" />
						<span>Drop files to attach</span>
					</div>
				</div>
			{/if}

			{#if attachments.length > 0}
				<div
					class={`mb-2 flex flex-wrap gap-2 overflow-y-auto px-3 pb-1 ${isComposerExpanded ? 'max-h-36' : 'max-h-24'}`}
					data-drawer-swipe-ignore
				>
					{#each attachments as attachment (attachment.id)}
						<div class={`group relative shrink-0 overflow-hidden rounded-2xl border border-border-subtle bg-bg-content transition-colors hover:border-border-strong ${attachment.kind === 'image' ? 'h-20 w-20 bg-bg-hover/45' : 'flex h-20 w-36 items-center px-3 py-2'}`}>
							{#if attachment.kind === 'image'}
								<img src={attachment.previewUrl} alt={attachment.name} class="h-full w-full object-contain" />
							{:else}
								<div class="min-w-0 flex-1 pr-4">
									<div class="truncate text-[12px] font-medium leading-4 text-text-primary" title={attachment.name}>{attachment.name}</div>
									<div class="mt-0.5 flex items-center gap-1.5 text-[10px] leading-3 text-text-tertiary">
										<span>Text</span>
										<span aria-hidden="true">·</span>
										<span>{Math.ceil(attachment.size / 1024)} KB</span>
									</div>
								</div>
							{/if}
							<button
								type="button"
								class="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-bg-elevated/90 text-text-tertiary opacity-0 shadow-sm ring-1 ring-border-subtle transition-all hover:text-text-primary group-hover:opacity-100"
								onclick={() => onremoveattachment?.(attachment.id)}
								title="Remove attachment"
							>
								<X class="h-3.5 w-3.5" />
							</button>
						</div>
					{/each}
				</div>
			{/if}

			<div class="flex items-end gap-2">
				<div class="relative min-w-0 flex-1 rounded-[22px] bg-transparent px-3 py-1.5 ring-1 ring-transparent transition-colors focus-within:bg-transparent focus-within:ring-transparent">
					<input
						bind:this={fileInputEl}
						type="file"
						accept={COMPOSER_ATTACHMENT_ACCEPT}
						multiple
						class="hidden"
						onchange={(event) => {
							onpickattachment?.((event.currentTarget as HTMLInputElement).files);
							(event.currentTarget as HTMLInputElement).value = "";
						}}
					/>

					<textarea
						bind:this={textareaEl}
						bind:value
						rows="1"
						placeholder={placeholder}
						class="block min-h-[44px] w-full resize-none overflow-y-auto bg-transparent px-0 py-0 text-[14px] leading-6 text-text-primary outline-none placeholder:text-text-placeholder"
						oninput={() => resizeTextarea()}
						ondragover={handlePathDragOver}
						ondragleave={handlePathDragLeave}
						ondrop={handlePathDrop}
						onpaste={handlePaste}
						onblur={() => {
							setTimeout(() => {
								showPromptSuggestions = false;
							}, 120);
						}}
						onfocus={() => {
							if (slashCommandActive && (filteredPromptTemplates.length > 0 || slashCommandLoading)) {
								showPromptSuggestions = true;
							}
						}}
						onkeydown={(event) => {
							if (event.key === 'Escape' && showPromptSuggestions) {
								event.preventDefault();
								showPromptSuggestions = false;
								return;
							}

							if (showPromptSuggestions && (filteredPromptTemplates.length > 0 || slashCommandLoading)) {
								const key = event.key.toLowerCase();
								const isEmacsNext = event.ctrlKey && !event.metaKey && !event.altKey && key === 'n';
								const isEmacsPrevious = event.ctrlKey && !event.metaKey && !event.altKey && key === 'p';

								if (filteredPromptTemplates.length > 0 && (event.key === 'ArrowDown' || isEmacsNext)) {
									event.preventDefault();
									selectedPromptIndex = Math.min(selectedPromptIndex + 1, filteredPromptTemplates.length - 1);
									return;
								}
								if (filteredPromptTemplates.length > 0 && (event.key === 'ArrowUp' || isEmacsPrevious)) {
									event.preventDefault();
									selectedPromptIndex = Math.max(selectedPromptIndex - 1, 0);
									return;
								}
								if (filteredPromptTemplates.length > 0 && event.key === 'Home') {
									event.preventDefault();
									selectedPromptIndex = 0;
									return;
								}
								if (filteredPromptTemplates.length > 0 && event.key === 'End') {
									event.preventDefault();
									selectedPromptIndex = filteredPromptTemplates.length - 1;
									return;
								}
								if (filteredPromptTemplates.length > 0 && (event.key === 'Tab' || event.key === 'Enter')) {
									if (!(event.key === 'Enter' && event.shiftKey)) {
										event.preventDefault();
										const selected = filteredPromptTemplates[selectedPromptIndex];
										if (selected) applyPromptTemplate(selected);
										return;
									}
								}
								if (event.key === 'Escape') {
									showPromptSuggestions = false;
									return;
								}
							}

							if (event.key === 'Escape') {
								event.preventDefault();
								textareaEl?.blur();
								return;
							}

							if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && !event.isComposing) {
								event.preventDefault();
								if (!submitDisabled && hasDraft) {
									onsubmit();
								}
								return;
							}

							if (event.key === 'Escape' && isComposerExpanded) {
								event.preventDefault();
								isComposerExpanded = false;
								requestAnimationFrame(resizeTextarea);
								return;
							}

							if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
								if (isMobile() || isComposerExpanded) return;
								event.preventDefault();
								if (!submitDisabled && hasDraft) {
									onsubmit();
								}
							}
						}}
					></textarea>

					<SlashCommandMenu
						open={showPromptSuggestions}
						items={filteredPromptTemplates}
						query={slashCommandQuery}
						selectedIndex={selectedPromptIndex}
						loading={slashCommandLoading}
						onhighlight={(index) => {
							selectedPromptIndex = index;
						}}
						onselect={applyPromptTemplate}
					/>

					<div class="mt-1.5 flex items-center justify-between gap-2">
						<div class="flex items-center gap-1">
							<button
								type="button"
								class="-ml-2 flex h-8.5 w-8.5 shrink-0 items-center justify-center rounded-full text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
								onclick={() => fileInputEl?.click()}
								disabled={disabled || sending}
								title="Add files"
							>
								<Plus class="h-[17px] w-[17px]" />
							</button>

							{#if onModelSelect}
								<button
									type="button"
									class="flex items-center gap-1 h-7 px-2 rounded-full text-[11px] text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-primary border border-border-subtle disabled:cursor-not-allowed disabled:opacity-50"
									onclick={() => onModelSelect?.()}
									disabled={disabled || sending}
									title="Select model"
								>
									<span class="max-w-[120px] truncate">
										{currentModel?.name ?? currentModel?.id ?? 'Model'}
									</span>
									<ChevronDown class="h-3 w-3 opacity-50" />
								</button>
							{/if}
						</div>

						<div class="flex items-center gap-2">
							<button
								type="button"
								class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
								onclick={toggleComposerExpanded}
								disabled={disabled}
								title={isComposerExpanded ? "Collapse editor" : "Expand editor"}
								aria-label={isComposerExpanded ? "Collapse editor" : "Expand editor"}
								aria-pressed={isComposerExpanded}
							>
								{#if isComposerExpanded}
									<Minimize2 class="h-4 w-4" />
								{:else}
									<Maximize2 class="h-4 w-4" />
								{/if}
							</button>
							<button
								type={showAbort ? "button" : "submit"}
								disabled={showAbort ? disabled || aborting : submitDisabled}
								class={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white transition-all hover:scale-[1.02] disabled:scale-100 disabled:cursor-not-allowed disabled:bg-bg-hover-strong disabled:text-text-disabled ${showAbort ? 'bg-text-primary hover:bg-text-secondary' : 'bg-brand hover:bg-brand-hover'}`}
								title={showAbort ? "Stop generation" : "Send"}
								aria-label={showAbort ? "Stop generation" : "Send"}
								onclick={() => {
									if (showAbort) onabort?.();
								}}
							>
								{#if showAbort}
									<Square class="h-3.5 w-3.5 fill-current" />
								{:else}
									<ArrowUp class="h-4 w-4" />
								{/if}
							</button>
						</div>
					</div>
				</div>
			</div>
		</form>
	</div>
</div>
