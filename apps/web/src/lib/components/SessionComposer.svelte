<script lang="ts">
import { ArrowUp, ImagePlus, Paperclip, Sparkles, Upload, X } from "lucide-svelte";

type ComposerImageAttachment = {
	id: string;
	name: string;
	mediaType: string;
	data: string;
	previewUrl: string;
	size: number;
};

type Props = {
	value: string;
	disabled?: boolean;
	streamError?: string;
	selectedModel?: string;
	modelOptions?: string[];
	attachments?: ComposerImageAttachment[];
	onsubmit: () => void;
	onpickimage?: (files: FileList | File[] | null) => void;
	onremoveattachment?: (id: string) => void;
};

let {
	value = $bindable(""),
	disabled = false,
	streamError = "",
	selectedModel = "Auto",
	modelOptions = ["Auto"],
	attachments = [],
	onsubmit,
	onpickimage,
	onremoveattachment,
}: Props = $props();

let textareaEl = $state<HTMLTextAreaElement | null>(null);
let fileInputEl = $state<HTMLInputElement | null>(null);
let isDragOver = $state(false);
let dragCounter = 0;

function resizeTextarea() {
	if (!textareaEl) return;
	textareaEl.style.height = "0px";
	const nextHeight = Math.min(textareaEl.scrollHeight, 200);
	textareaEl.style.height = `${Math.max(nextHeight, 56)}px`;
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

<div class="sticky bottom-0 z-20 border-t border-border-subtle bg-linear-to-t from-bg-primary via-bg-primary/96 to-bg-primary/84 px-3 pb-3 pt-3 backdrop-blur supports-[backdrop-filter]:bg-bg-primary/78 sm:px-4 sm:pb-4">
	<div class="mx-auto max-w-4xl">
		{#if streamError}
			<div class="mb-3 rounded-2xl border border-rose-500/25 bg-rose-500/10 px-3 py-2 text-[11px] text-rose-400">
				{streamError}
			</div>
		{/if}

		<form
			class={`relative rounded-[28px] border p-2 shadow-[0_10px_30px_rgba(0,0,0,0.16)] transition-colors ${isDragOver ? 'border-brand/50 bg-brand/5' : 'border-border-subtle bg-bg-surface/78 focus-within:border-brand/30 focus-within:bg-bg-surface/92'}`}
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
				<div class="mb-2 flex gap-2 overflow-x-auto px-1 pb-1">
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
				<div class="min-w-0 flex-1 rounded-[22px] bg-bg-content/62 px-3 py-2.5 ring-1 ring-transparent transition-colors focus-within:bg-bg-content/82 focus-within:ring-brand/10">
					<div class="mb-2 flex flex-wrap items-center gap-2">
						<div class="inline-flex items-center gap-1.5 rounded-full border border-border-subtle bg-bg-primary/70 px-2.5 py-1 text-[11px] text-text-secondary">
							<Sparkles class="h-3.5 w-3.5" />
							<span>Model</span>
							<select
								class="bg-transparent text-text-primary outline-none"
								bind:value={selectedModel}
								disabled
								title="模型选择占位，暂未接入逻辑"
							>
								{#each modelOptions as option}
									<option value={option}>{option}</option>
								{/each}
							</select>
						</div>

						<button
							type="button"
							class="inline-flex items-center gap-1.5 rounded-full border border-border-subtle bg-bg-primary/70 px-2.5 py-1 text-[11px] text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
							onclick={() => fileInputEl?.click()}
							disabled={disabled}
						>
							<ImagePlus class="h-3.5 w-3.5" />
							<span>Add image</span>
						</button>

						<div class="inline-flex items-center gap-1.5 rounded-full border border-dashed border-border-subtle bg-bg-primary/45 px-2.5 py-1 text-[11px] text-text-placeholder">
							<Paperclip class="h-3.5 w-3.5" />
							<span>Tools soon</span>
						</div>

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
					</div>

					<textarea
						bind:this={textareaEl}
						bind:value
						rows="1"
						placeholder="Send a message..."
						class="block min-h-[56px] max-h-[200px] w-full resize-none bg-transparent px-0 py-0 text-[14px] leading-6 text-text-primary outline-none placeholder:text-text-placeholder"
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

					<div class="mt-2 flex items-center justify-between gap-3 px-0.5">
						<div class="text-[11px] text-text-tertiary">
							<span class="text-text-secondary">Enter</span>
							<span class="mx-1 text-text-placeholder">发送</span>
							<span class="text-text-secondary">Shift + Enter</span>
							<span class="mx-1 text-text-placeholder">换行</span>
							<span class="mx-1 text-text-placeholder">·</span>
							<span class="text-text-secondary">Paste / Drop image</span>
						</div>
						<div class="truncate text-[11px] text-text-placeholder">
							{disabled ? "Session unavailable" : attachments.length > 0 ? `${attachments.length} image${attachments.length > 1 ? 's' : ''} attached` : "AI may make mistakes"}
						</div>
					</div>
				</div>

				<button
					type="submit"
					disabled={disabled || (!value.trim() && attachments.length === 0)}
					class="mb-1 flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-brand text-white transition-all hover:scale-[1.02] hover:bg-brand-hover disabled:scale-100 disabled:cursor-not-allowed disabled:bg-bg-hover-strong disabled:text-text-disabled"
					title="Send"
				>
					<ArrowUp class="h-[18px] w-[18px]" />
				</button>
			</div>
		</form>
	</div>
</div>
