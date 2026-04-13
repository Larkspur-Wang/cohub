<script lang="ts">
import { ArrowUp, ChevronDown, Plus, Upload, X } from "lucide-svelte";

type ComposerImageAttachment = {
	id: string;
	name: string;
	mediaType: string;
	data: string;
	previewUrl: string;
	size: number;
};

type SelectedModel = {
	provider: string;
	id: string;
	name?: string;
};

type Props = {
	value: string;
	disabled?: boolean;
	streamError?: string;
	attachments?: ComposerImageAttachment[];
	currentModel?: SelectedModel | null;
	onsubmit: () => void;
	onpickimage?: (files: FileList | File[] | null) => void;
	onremoveattachment?: (id: string) => void;
	onModelSelect?: () => void;
};

let {
	value = $bindable(""),
	disabled = false,
	streamError = "",
	attachments = [],
	currentModel = null,
	onsubmit,
	onpickimage,
	onremoveattachment,
	onModelSelect,
}: Props = $props();

let textareaEl = $state<HTMLTextAreaElement | null>(null);
let fileInputEl = $state<HTMLInputElement | null>(null);
let isDragOver = $state(false);
let dragCounter = 0;

function resizeTextarea() {
	if (!textareaEl) return;
	textareaEl.style.height = "0px";
	const nextHeight = Math.min(textareaEl.scrollHeight, 168);
	textareaEl.style.height = `${Math.max(nextHeight, 44)}px`;
}

function hasImageFiles(dataTransfer: DataTransfer | null) {
	if (!dataTransfer) return false;
	return Array.from(dataTransfer.items ?? []).some((item) => item.type.startsWith("image/"));
}

function handleDragEnter(event: DragEvent) {
	if (!hasImageFiles(event.dataTransfer)) return;
	event.preventDefault();
	dragCounter += 1;
	isDragOver = true;
}

function handleDragOver(event: DragEvent) {
	if (!hasImageFiles(event.dataTransfer)) return;
	event.preventDefault();
	isDragOver = true;
}

function handleDragLeave(event: DragEvent) {
	if (!hasImageFiles(event.dataTransfer)) return;
	event.preventDefault();
	dragCounter = Math.max(0, dragCounter - 1);
	if (dragCounter === 0) {
		isDragOver = false;
	}
}

function handleDrop(event: DragEvent) {
	if (!hasImageFiles(event.dataTransfer)) return;
	event.preventDefault();
	isDragOver = false;
	dragCounter = 0;
	onpickimage?.(event.dataTransfer?.files ?? null);
}

function handlePaste(event: ClipboardEvent) {
	const files = Array.from(event.clipboardData?.items ?? [])
		.filter((item) => item.type.startsWith("image/"))
		.map((item) => item.getAsFile())
		.filter((file): file is File => file instanceof File);

	if (files.length === 0) return;
	event.preventDefault();
	onpickimage?.(files);
}

$effect(() => {
	value;
	attachments.length;
	resizeTextarea();
});
</script>

<div class="relative pointer-events-none sticky bottom-0 z-20 -mt-6 px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-2 sm:px-6 sm:pb-4">
	<div class="pointer-events-none absolute inset-x-0 bottom-0 top-0 bg-linear-to-t from-bg-content via-bg-content/72 to-transparent"></div>
	<div class="pointer-events-auto relative mx-auto max-w-4xl">
		{#if streamError}
			<div class="mb-3 rounded-2xl border border-rose-500/25 bg-rose-500/10 px-3 py-2 text-[11px] text-rose-400">
				{streamError}
			</div>
		{/if}

		<form
			class={`relative rounded-[28px] border p-2 shadow-[0_12px_36px_rgba(15,23,42,0.08)] backdrop-blur-md transition-colors ${isDragOver ? 'border-brand/50 bg-brand/5' : 'border-border-subtle/70 bg-bg-content/92 focus-within:border-brand/25 focus-within:bg-bg-content/96'}`}
			onsubmit={(event) => {
				event.preventDefault();
				onsubmit();
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
						<span>Drop images to attach</span>
					</div>
				</div>
			{/if}

			{#if attachments.length > 0}
				<div class="mb-2 flex flex-wrap gap-2 px-1 pb-1" data-drawer-swipe-ignore>
					{#each attachments as attachment (attachment.id)}
						<div class="group relative h-20 w-20 shrink-0 overflow-hidden rounded-2xl border border-border-subtle bg-bg-content">
							<img src={attachment.previewUrl} alt={attachment.name} class="h-full w-full object-cover" />
							<button
								type="button"
								class="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-black/65 text-white opacity-0 transition-opacity group-hover:opacity-100"
								onclick={() => onremoveattachment?.(attachment.id)}
								title="Remove image"
							>
								<X class="h-3.5 w-3.5" />
							</button>
						</div>
					{/each}
				</div>
			{/if}

			<div class="flex items-end gap-2">
				<div class="min-w-0 flex-1 rounded-[22px] bg-transparent px-3 py-1.5 ring-1 ring-transparent transition-colors focus-within:bg-transparent focus-within:ring-transparent">
					<input
						bind:this={fileInputEl}
						type="file"
						accept="image/*"
						multiple
						class="hidden"
						onchange={(event) => {
							onpickimage?.((event.currentTarget as HTMLInputElement).files);
							(event.currentTarget as HTMLInputElement).value = "";
						}}
					/>

					<textarea
						bind:this={textareaEl}
						bind:value
						rows="1"
						placeholder="Send a message..."
						class="block min-h-[44px] max-h-[168px] w-full resize-none bg-transparent px-0 py-0 text-[14px] leading-6 text-text-primary outline-none placeholder:text-text-placeholder"
						oninput={() => resizeTextarea()}
						onpaste={handlePaste}
						onkeydown={(event) => {
							if (event.key === 'Enter' && !event.shiftKey) {
								event.preventDefault();
								if (!disabled && (value.trim() || attachments.length > 0)) {
									onsubmit();
								}
							}
						}}
					></textarea>

					<div class="mt-1.5 flex items-center justify-between gap-2">
						<div class="flex items-center gap-1">
							<button
								type="button"
								class="flex h-8.5 w-8.5 shrink-0 items-center justify-center rounded-full text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
								onclick={() => fileInputEl?.click()}
								disabled={disabled}
								title="Add image"
							>
								<Plus class="h-[17px] w-[17px]" />
							</button>

							{#if onModelSelect}
								<button
									type="button"
									class="flex items-center gap-1 h-7 px-2 rounded-full text-[11px] text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-primary border border-border-subtle disabled:cursor-not-allowed disabled:opacity-50"
									onclick={() => onModelSelect?.()}
									disabled={disabled}
									title="Select model"
								>
									<span class="max-w-[120px] truncate">
										{currentModel?.name ?? currentModel?.id ?? 'Model'}
									</span>
									<ChevronDown class="h-3 w-3 opacity-50" />
								</button>
							{/if}
						</div>

						<button
							type="submit"
							disabled={disabled || (!value.trim() && attachments.length === 0)}
							class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand text-white transition-all hover:scale-[1.02] hover:bg-brand-hover disabled:scale-100 disabled:cursor-not-allowed disabled:bg-bg-hover-strong disabled:text-text-disabled"
							title="Send"
						>
							<ArrowUp class="h-4 w-4" />
						</button>
					</div>
				</div>
			</div>
		</form>
	</div>
</div>
