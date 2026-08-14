<script lang="ts">
import type { PublicGenerationDeclaration } from "@cohub/protocol/generation";
import type { BoardItem } from "@neta-art/cohub/board";
import { worldPoint } from "@neta-art/cohub/board";
import {
	ArrowUp,
	AudioLines,
	ChevronDown,
	Image,
	Link2,
	LoaderCircle,
	Plus,
	Search,
	Settings2,
	Video,
	X,
} from "lucide-svelte";
import { onDestroy, onMount } from "svelte";
import type { BoardAssetSource } from "$lib/board/board-asset-source";
import {
	type BoardGenerationMediaType,
	type BoardGenerationReference,
	buildBoardGenerationContent,
	defaultGenerationReferenceRole,
	generationInputSpec,
	modelAcceptsGenerationReferences,
	normalizeGenerationReferenceUrl,
	parseBoardGenerationReferences,
	pendingGenerationTaskSnapshot,
	supportsBoardGenerationComposer,
	validateBoardGeneration,
	validateBoardGenerationParameters,
} from "$lib/board/board-generation";
import type { BoardEditor } from "$lib/board/editor.svelte";
import { canUseUserScopedCache, getCacheUserKey } from "$lib/cache/keys";
import { getGenerationModelPickerItems } from "$lib/generation-model-catalog";
import { sdk } from "$lib/sdk";
import {
	getCachedGenerationModels,
	loadGenerationModels,
} from "$lib/stores/generation-models-cache";
import { watchGenerationTask } from "$lib/stores/generation-task-watch";
import { mergeCachedTaskRun } from "$lib/stores/task-runs-cache";

const {
	editor,
	spaceId,
	boardId,
	assetSource,
	immersive = false,
	onClose,
}: {
	editor: BoardEditor;
	spaceId: string;
	boardId: string;
	assetSource: BoardAssetSource;
	immersive?: boolean;
	onClose: () => void;
} = $props();

const cacheUserKey = getCacheUserKey();
const cacheEnabled = canUseUserScopedCache(cacheUserKey);
const modelStorageKey = `cohub:board-generation:model:${encodeURIComponent(cacheUserKey)}`;
const draftKey = $derived(
	`cohub:board-generation:draft:${encodeURIComponent(cacheUserKey)}:${spaceId}:${boardId}`,
);
const initialModels = getCachedGenerationModels();
let prompt = $state("");
let references = $state<BoardGenerationReference[]>([]);
let models = $state<PublicGenerationDeclaration[]>(initialModels);
let selectedModelId = $state("");
let parametersByModel = $state<Record<string, Record<string, unknown>>>({});
let modelOpen = $state(false);
let settingsOpen = $state(false);
let referenceOpen = $state(false);
let modelQuery = $state("");
let referenceUrl = $state("");
let referenceType = $state<BoardGenerationMediaType>("image");
let loadingModels = $state(initialModels.length === 0);
let resolvingSelection = $state(false);
let submitting = $state(false);
let startedTaskRunId = $state<string | null>(null);
let error = $state<string | null>(null);
let textarea: HTMLTextAreaElement | null = $state(null);
let disposed = false;

function readStorage(key: string) {
	if (!cacheEnabled) return null;
	try {
		return localStorage.getItem(key);
	} catch {
		return null;
	}
}

function writeStorage(key: string, value: string | null) {
	if (!cacheEnabled) return;
	try {
		if (value === null) localStorage.removeItem(key);
		else localStorage.setItem(key, value);
	} catch {}
}

const supportedModels = $derived(
	models.filter((model) => supportsBoardGenerationComposer(model, references)),
);
const selectedModel = $derived(
	supportedModels.find((model) => model.model === selectedModelId) ?? null,
);
const parameters = $derived.by(() => {
	const saved = parametersByModel[selectedModelId] ?? {};
	if (!selectedModel || selectedModel.allowUnknownParameters) return saved;
	const declared = selectedModel.parameters ?? {};
	return Object.fromEntries(
		Object.entries(saved).filter(([name]) => name in declared),
	);
});
const visibleModels = $derived(
	getGenerationModelPickerItems(supportedModels, {
		query: modelQuery,
		selectedModelIds: selectedModelId ? [selectedModelId] : [],
	}),
);
const validationError = $derived(
	validateBoardGeneration({ model: selectedModel, prompt, references }) ??
		validateBoardGenerationParameters(selectedModel, parameters),
);
const parameterEntries = $derived(
	Object.entries(selectedModel?.parameters ?? {}),
);

function mediaIcon(type: BoardGenerationMediaType) {
	if (type === "video") return Video;
	if (type === "audio") return AudioLines;
	return Image;
}

function itemMediaType(item: BoardItem): BoardGenerationMediaType | null {
	if (item.type === "image" || item.type === "video" || item.type === "audio")
		return item.type;
	if (item.type === "file") {
		const mimeType = item.snapshot?.mimeType ?? "";
		if (mimeType.startsWith("image/")) return "image";
		if (mimeType.startsWith("video/")) return "video";
		if (mimeType.startsWith("audio/")) return "audio";
	}
	if (item.type === "task") {
		const type = item.snapshot.primaryOutput?.type;
		return type === "image" || type === "video" || type === "audio"
			? type
			: null;
	}
	return null;
}

function itemLabel(item: BoardItem): string {
	if (
		item.type === "image" ||
		item.type === "video" ||
		item.type === "audio" ||
		item.type === "file"
	) {
		return (
			item.snapshot?.title ?? item.ref.path.split("/").pop() ?? item.ref.path
		);
	}
	if (item.type === "task") return item.snapshot.title;
	return "Reference";
}

async function resolveItemReference(
	item: BoardItem,
): Promise<BoardGenerationReference | null> {
	const type = itemMediaType(item);
	if (!type) return null;
	let rawUrl: string | undefined | null;
	if (
		item.type === "image" ||
		item.type === "video" ||
		item.type === "audio" ||
		item.type === "file"
	) {
		rawUrl = await assetSource.resolveFileUrl(item.ref.path);
	} else if (item.type === "task") {
		rawUrl = item.snapshot.primaryOutput?.url;
	}
	const url = rawUrl ? normalizeGenerationReferenceUrl(rawUrl) : null;
	if (!url) return null;
	return { id: item.id, type, url, label: itemLabel(item) };
}

function roleFor(
	type: BoardGenerationMediaType,
	current?: string,
	model: PublicGenerationDeclaration | null = selectedModel,
) {
	if (!model) return current;
	const spec = generationInputSpec(model, type);
	if (current && spec?.roles?.includes(current)) return current;
	return defaultGenerationReferenceRole(model, type);
}

function normalizeReferenceRoles(
	next: BoardGenerationReference[],
	model: PublicGenerationDeclaration | null = selectedModel,
) {
	return next.map((reference) => ({
		...reference,
		role: roleFor(reference.type, reference.role, model),
	}));
}

async function addSelectedReferences() {
	const candidates = editor.selectedItems.filter((item) => itemMediaType(item));
	if (candidates.length === 0) return;
	resolvingSelection = true;
	try {
		const results = await Promise.allSettled(
			candidates.map(resolveItemReference),
		);
		if (disposed) return;
		const resolved = results
			.filter(
				(result): result is PromiseFulfilledResult<BoardGenerationReference> =>
					result.status === "fulfilled" && result.value !== null,
			)
			.map((result) => result.value);
		const known = new Set(references.map((reference) => reference.url));
		const added = resolved.filter((reference) => !known.has(reference.url));
		references = normalizeReferenceRoles([...references, ...added]);
		const failed = results.filter((result) => result.status === "rejected");
		if (failed.length > 0 || added.length < candidates.length) {
			error =
				failed.length > 0
					? "Failed to load some selected media."
					: "Some selected media has no remote URL.";
		}
	} finally {
		if (!disposed) resolvingSelection = false;
	}
}

function addUrlReference() {
	const url = normalizeGenerationReferenceUrl(referenceUrl);
	if (!url) {
		error = "Enter an HTTP or HTTPS URL.";
		return;
	}
	if (!references.some((reference) => reference.url === url)) {
		references = normalizeReferenceRoles([
			...references,
			{
				id: crypto.randomUUID(),
				type: referenceType,
				url,
				label: new URL(url).hostname,
			},
		]);
	}
	referenceUrl = "";
	referenceOpen = false;
	error = null;
}

function removeReference(id: string) {
	references = references.filter((reference) => reference.id !== id);
}

function updateReferenceRole(id: string, role: string) {
	references = references.map((reference) =>
		reference.id === id ? { ...reference, role: role || undefined } : reference,
	);
}

function chooseModel(model: PublicGenerationDeclaration) {
	selectedModelId = model.model;
	references = normalizeReferenceRoles(references, model);
	writeStorage(modelStorageKey, model.model);
	modelOpen = false;
	modelQuery = "";
	error = null;
}

function updateParameter(name: string, value: unknown) {
	parametersByModel = {
		...parametersByModel,
		[selectedModelId]: {
			...(parametersByModel[selectedModelId] ?? {}),
			[name]: value,
		},
	};
}

function clearParameter(name: string) {
	const next = { ...(parametersByModel[selectedModelId] ?? {}) };
	delete next[name];
	parametersByModel = { ...parametersByModel, [selectedModelId]: next };
}

function restoreDraft() {
	try {
		const raw = readStorage(draftKey);
		if (!raw) return;
		const parsed = JSON.parse(raw) as {
			prompt?: unknown;
			model?: unknown;
			references?: unknown;
			parametersByModel?: unknown;
		};
		if (typeof parsed.prompt === "string") prompt = parsed.prompt;
		if (typeof parsed.model === "string") selectedModelId = parsed.model;
		references = parseBoardGenerationReferences(parsed.references);
		if (
			parsed.parametersByModel &&
			typeof parsed.parametersByModel === "object" &&
			!Array.isArray(parsed.parametersByModel)
		) {
			const next: Record<string, Record<string, unknown>> = {};
			for (const [modelId, params] of Object.entries(
				parsed.parametersByModel,
			)) {
				if (params && typeof params === "object" && !Array.isArray(params)) {
					const filtered: Record<string, unknown> = {};
					for (const [key, value] of Object.entries(params)) {
						if (
							typeof value === "string" ||
							typeof value === "number" ||
							typeof value === "boolean"
						) {
							filtered[key] = value;
						}
					}
					if (Object.keys(filtered).length > 0) next[modelId] = filtered;
				}
			}
			parametersByModel = next;
		}
	} catch {
		writeStorage(draftKey, null);
	}
}

function hasDraft() {
	if (prompt.trim() || references.length > 0) return true;
	return Object.values(parametersByModel).some(
		(params) => Object.keys(params).length > 0,
	);
}

function persistDraft() {
	writeStorage(
		draftKey,
		hasDraft()
			? JSON.stringify({
					prompt,
					model: selectedModelId,
					references,
					parametersByModel,
				})
			: null,
	);
}

function taskPosition() {
	const bounds = editor.bounds;
	if (!bounds) return editor.viewCenter();
	return worldPoint(
		bounds.x + bounds.width + 180,
		bounds.y + bounds.height / 2,
	);
}

async function submit() {
	if (submitting || startedTaskRunId || validationError || !selectedModel) {
		error = startedTaskRunId ? "Generation already started." : validationError;
		return;
	}
	submitting = true;
	error = null;
	const submittingUserKey = getCacheUserKey();
	const snapshotModel = selectedModel;
	const snapshotModelId = snapshotModel.model;
	const snapshotPrompt = prompt;
	const snapshotReferences = references;
	const snapshotParameters = { ...parameters };
	const content = buildBoardGenerationContent(
		snapshotPrompt,
		snapshotReferences,
	);
	let taskRunId: string;
	try {
		const created = await sdk.generations.create({
			spaceId,
			model: snapshotModel.model,
			content,
			...(Object.keys(snapshotParameters).length > 0
				? { parameters: snapshotParameters }
				: {}),
		});
		taskRunId = created.taskRunId;
	} catch (cause) {
		error =
			cause instanceof Error ? cause.message : "Generation could not start.";
		submitting = false;
		return;
	}

	// Creation is the irreversible boundary: never offer another submit after it.
	startedTaskRunId = taskRunId;
	const currentUserKey = getCacheUserKey();
	if (currentUserKey !== submittingUserKey) {
		error = "Task created. Find it in Tasks list.";
		submitting = false;
		return;
	}
	watchGenerationTask(spaceId, taskRunId, submittingUserKey);

	let nodeAdded = false;
	try {
		const snapshot = pendingGenerationTaskSnapshot({
			prompt: snapshotPrompt,
			model: snapshotModel.model,
		});
		try {
			if (getCacheUserKey() !== submittingUserKey) return;
			mergeCachedTaskRun(spaceId, {
				id: taskRunId,
				taskType: "generation",
				status: "pending",
				spaceId,
				payload: {
					type: "generation",
					data: {
						model: snapshotModel.model,
						content,
						parameters: snapshotParameters,
					},
				},
				updatedAt: snapshot.updatedAt,
			});
		} catch {}

		const id = editor.addTask(taskRunId, snapshot, taskPosition());
		nodeAdded = true;
		editor.setSelection([id]);
	} catch {
		error = "Generation started. Open it from Tasks.";
	} finally {
		if (prompt === snapshotPrompt) prompt = "";
		if (references === snapshotReferences) references = [];
		const current = parametersByModel[snapshotModelId] ?? {};
		if (
			Object.keys(current).length > 0 &&
			JSON.stringify(current) === JSON.stringify(snapshotParameters)
		) {
			parametersByModel = {
				...parametersByModel,
				[snapshotModelId]: {},
			};
		}
		persistDraft();
		submitting = false;
	}
	if (nodeAdded) onClose();
}

function handleKeydown(event: KeyboardEvent) {
	if (event.key === "Escape") {
		if (modelOpen || settingsOpen || referenceOpen) {
			modelOpen = false;
			settingsOpen = false;
			referenceOpen = false;
			return;
		}
		persistDraft();
		onClose();
		return;
	}
	if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
		event.preventDefault();
		void submit();
	}
}

onMount(() => {
	restoreDraft();
	const preferred = selectedModelId || readStorage(modelStorageKey) || "";
	const initialModel =
		supportedModels.find((model) => model.model === preferred) ??
		getGenerationModelPickerItems(supportedModels)[0] ??
		null;
	selectedModelId = initialModel?.model ?? "";
	references = normalizeReferenceRoles(references, initialModel);
	void addSelectedReferences();
	void loadGenerationModels({ refresh: true })
		.then((loaded) => {
			if (disposed) return;
			models = loaded;
			const usable = loaded.filter((model) =>
				supportsBoardGenerationComposer(model, references),
			);
			let current = usable.find((model) => model.model === selectedModelId);
			if (!current) {
				current = getGenerationModelPickerItems(usable).find((model) =>
					modelAcceptsGenerationReferences(model, references),
				);
				selectedModelId = current?.model ?? "";
			}
			references = normalizeReferenceRoles(references, current ?? null);
		})
		.catch(() => {
			if (!disposed && models.length === 0)
				error = "Models could not be loaded.";
		})
		.finally(() => {
			if (!disposed) loadingModels = false;
		});
	requestAnimationFrame(() => textarea?.focus());
});

$effect(() => {
	prompt;
	references;
	selectedModelId;
	parametersByModel;
	const timer = window.setTimeout(persistDraft, 250);
	return () => window.clearTimeout(timer);
});

onDestroy(() => {
	disposed = true;
	persistDraft();
});
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="generation-wrap" class:generation-wrap--immersive={immersive}>
	<div class="generation-composer">
		{#if references.length > 0 || resolvingSelection}
			<div class="reference-strip" aria-label="Generation references">
				{#each references as reference (reference.id)}
					{@const ReferenceIcon = mediaIcon(reference.type)}
					{@const spec = selectedModel ? generationInputSpec(selectedModel, reference.type) : null}
					<div class="reference-pill" title={reference.url}>
						<ReferenceIcon class="h-3.5 w-3.5 shrink-0" />
						<span class="max-w-28 truncate">{reference.label}</span>
						{#if spec?.roles?.length}
							<select
								class="role-select"
								aria-label={`Role for ${reference.label}`}
								value={reference.role ?? ""}
								onchange={(event) => updateReferenceRole(reference.id, event.currentTarget.value)}
							>
								{#if !spec.roleRequired}<option value="">Auto</option>{/if}
								{#each spec.roles as role (role)}<option value={role}>{role.replaceAll("_", " ")}</option>{/each}
							</select>
						{/if}
						<button type="button" class="mini-btn" title="Remove reference" aria-label="Remove reference" onclick={() => removeReference(reference.id)}>
							<X class="h-3 w-3" />
						</button>
					</div>
				{/each}
				{#if resolvingSelection}<LoaderCircle class="h-3.5 w-3.5 animate-spin text-text-tertiary" />{/if}
			</div>
		{/if}

		<textarea
			bind:this={textarea}
			bind:value={prompt}
			rows="2"
			placeholder="Describe what to generate..."
			aria-label="Generation prompt"
		></textarea>

		<div class="composer-footer">
			<div class="footer-tools">
				<div class="relative">
					<button
						type="button"
						class="control-btn model-btn"
						aria-expanded={modelOpen}
						onclick={() => { modelOpen = !modelOpen; settingsOpen = false; referenceOpen = false; }}
					>
						{#if loadingModels && !selectedModel}<LoaderCircle class="h-3.5 w-3.5 animate-spin" />{/if}
						<span class="truncate">{selectedModel?.title ?? selectedModel?.model ?? "Model"}</span>
						<ChevronDown class="h-3 w-3 shrink-0" />
					</button>
					{#if modelOpen}
						<div class="popover model-popover">
							<label class="search-field">
								<Search class="h-3.5 w-3.5" />
								<input bind:value={modelQuery} placeholder="Search models" aria-label="Search generation models" />
							</label>
							<div class="model-list">
								{#each visibleModels as model (model.model)}
									{@const compatible = modelAcceptsGenerationReferences(model, references)}
									<button
										type="button"
										class="model-option"
										class:model-option--active={model.model === selectedModelId}
										disabled={!compatible}
										title={compatible ? model.description : "Incompatible with current references"}
										onclick={() => chooseModel(model)}
									>
										<span class="truncate font-medium">{model.title ?? model.model}</span>
										<span class="truncate text-[10px] text-text-tertiary">{model.model}</span>
									</button>
								{/each}
								{#if visibleModels.length === 0}<div class="empty-row">No matching models</div>{/if}
							</div>
						</div>
					{/if}
				</div>

				<div class="relative reference-anchor">
					<button
						type="button"
						class="icon-btn"
						title="Add reference URL"
						aria-label="Add reference URL"
						aria-expanded={referenceOpen}
						onclick={() => { referenceOpen = !referenceOpen; modelOpen = false; settingsOpen = false; }}
					>
						<Link2 class="h-3.5 w-3.5" />
					</button>
					{#if referenceOpen}
						<div class="popover reference-popover">
							<div class="media-segments" role="group" aria-label="Reference type">
								{#each ["image", "video", "audio"] as type (type)}
									{@const MediaIcon = mediaIcon(type as BoardGenerationMediaType)}
									<button type="button" class:active={referenceType === type} title={type} aria-label={type} onclick={() => { referenceType = type as BoardGenerationMediaType; }}>
										<MediaIcon class="h-3.5 w-3.5" />
									</button>
								{/each}
							</div>
							<div class="url-row">
								<input bind:value={referenceUrl} placeholder="https://..." aria-label="Reference URL" onkeydown={(event) => { if (event.key === "Enter") { event.preventDefault(); addUrlReference(); } }} />
								<button type="button" class="icon-btn" title="Add reference" aria-label="Add reference" onclick={addUrlReference}><Plus class="h-3.5 w-3.5" /></button>
							</div>
						</div>
					{/if}
				</div>

				{#if parameterEntries.length > 0}
					<div class="relative settings-anchor">
						<button
							type="button"
							class="icon-btn"
							class:icon-btn--active={settingsOpen}
							title="Generation settings"
							aria-label="Generation settings"
							aria-expanded={settingsOpen}
							onclick={() => { settingsOpen = !settingsOpen; modelOpen = false; referenceOpen = false; }}
						>
							<Settings2 class="h-3.5 w-3.5" />
						</button>
						{#if settingsOpen}
							<div class="popover settings-popover">
								{#each parameterEntries as [name, spec] (name)}
									<label class="parameter-row" title={spec.description}>
										<span>{name.replaceAll("_", " ")}</span>
										{#if spec.type === "boolean"}
											<input type="checkbox" checked={(parameters[name] ?? spec.default) === true} onchange={(event) => updateParameter(name, event.currentTarget.checked)} />
										{:else if spec.type === "string" && spec.enum}
											<select value={String(parameters[name] ?? spec.default ?? "")} onchange={(event) => event.currentTarget.value ? updateParameter(name, event.currentTarget.value) : clearParameter(name)}>
												<option value="">Auto</option>
												{#each spec.enum as value (value)}<option value={value}>{value}</option>{/each}
											</select>
										{:else if spec.type === "number" || spec.type === "integer"}
											<input type="number" min={spec.min} max={spec.max} step={spec.type === "integer" ? 1 : "any"} value={String(parameters[name] ?? spec.default ?? "")} placeholder={spec.default === undefined ? "Auto" : String(spec.default)} oninput={(event) => event.currentTarget.value ? updateParameter(name, Number(event.currentTarget.value)) : clearParameter(name)} />
										{:else}
											<input value={String(parameters[name] ?? spec.default ?? "")} placeholder={spec.default === undefined ? "Auto" : String(spec.default)} oninput={(event) => event.currentTarget.value ? updateParameter(name, event.currentTarget.value) : clearParameter(name)} />
										{/if}
									</label>
								{/each}
							</div>
						{/if}
					</div>
				{/if}
			</div>

			{#if error}<span class="error-text" title={error}>{error}</span>{/if}
			<button
				type="button"
				class="submit-btn"
				title={startedTaskRunId
					? "Generation started"
					: validationError ?? "Generate (Ctrl+Enter)"}
				aria-label="Generate"
				disabled={submitting || Boolean(startedTaskRunId || validationError)}
				onclick={() => { void submit(); }}
			>
				{#if submitting}<LoaderCircle class="h-4 w-4 animate-spin" />{:else}<ArrowUp class="h-4 w-4" />{/if}
			</button>
		</div>
	</div>
</div>

<style>
	.generation-wrap {
		position: absolute;
		left: 50%;
		bottom: 64px;
		z-index: 28;
		width: min(560px, calc(100% - 24px));
		transform: translateX(-50%);
	}
	.generation-wrap--immersive {
		left: calc((var(--preview-safe-left, 10px) + 100% - var(--preview-safe-right, 10px)) / 2);
		width: min(560px, calc(100% - var(--preview-safe-left, 10px) - var(--preview-safe-right, 10px) - 16px));
	}
	.generation-composer {
		position: relative;
		border: 1px solid var(--border-subtle);
		border-radius: 8px;
		background: color-mix(in srgb, var(--bg-elevated) 97%, transparent);
		box-shadow: 0 14px 34px color-mix(in srgb, var(--overlay-scrim-strong) 20%, transparent);
		backdrop-filter: blur(14px);
		overflow: visible;
	}
	textarea {
		display: block;
		width: 100%;
		min-height: 68px;
		max-height: 180px;
		resize: vertical;
		border: 0;
		background: transparent;
		padding: 12px 12px 7px;
		font-size: 13px;
		line-height: 1.5;
		color: var(--text-primary);
		outline: none;
	}
	textarea::placeholder { color: var(--text-tertiary); }
	.reference-strip {
		display: flex;
		align-items: center;
		gap: 5px;
		overflow-x: auto;
		padding: 8px 8px 0;
		scrollbar-width: none;
	}
	.reference-strip::-webkit-scrollbar { display: none; }
	.reference-pill {
		display: flex;
		min-width: 0;
		flex: 0 0 auto;
		align-items: center;
		gap: 5px;
		height: 26px;
		border: 1px solid var(--border-subtle);
		border-radius: 6px;
		background: var(--bg-surface);
		padding: 0 4px 0 7px;
		font-size: 11px;
		color: var(--text-secondary);
	}
	.role-select {
		max-width: 96px;
		border: 0;
		background: transparent;
		font-size: 10px;
		color: var(--text-tertiary);
		outline: none;
	}
	.composer-footer {
		display: flex;
		min-height: 40px;
		align-items: center;
		gap: 6px;
		border-top: 1px solid var(--border-subtle);
		padding: 5px 6px;
	}
	.footer-tools { display: flex; min-width: 0; flex: 1; align-items: center; gap: 3px; }
	.control-btn, .icon-btn, .mini-btn, .submit-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border: 1px solid transparent;
		color: var(--text-secondary);
		transition: background-color 100ms ease, color 100ms ease, border-color 100ms ease;
	}
	.control-btn:hover, .icon-btn:hover, .mini-btn:hover { background: var(--bg-hover); color: var(--text-primary); }
	.model-btn {
		max-width: 190px;
		height: 28px;
		gap: 5px;
		border-radius: 6px;
		padding: 0 7px;
		font-size: 11px;
	}
	.icon-btn { width: 28px; height: 28px; border-radius: 6px; }
	.icon-btn--active { background: var(--brand-bg); color: var(--brand-muted-fg); }
	.mini-btn { width: 20px; height: 20px; border-radius: 4px; }
	.submit-btn {
		width: 30px;
		height: 30px;
		flex: 0 0 auto;
		border-radius: 7px;
		background: var(--brand);
		color: var(--brand-contrast-fg);
	}
	.submit-btn:disabled { cursor: not-allowed; opacity: 0.4; }
	.error-text {
		max-width: 180px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 10px;
		color: var(--error-soft);
	}
	.popover {
		position: absolute;
		bottom: calc(100% + 7px);
		z-index: 3;
		border: 1px solid var(--border-subtle);
		border-radius: 7px;
		background: var(--bg-elevated);
		box-shadow: 0 12px 28px color-mix(in srgb, var(--overlay-scrim-strong) 22%, transparent);
	}
	.model-popover { left: 0; width: min(340px, calc(100vw - 32px)); padding: 5px; }
	.search-field {
		display: flex;
		align-items: center;
		gap: 6px;
		height: 30px;
		border-bottom: 1px solid var(--border-subtle);
		padding: 0 7px;
		color: var(--text-tertiary);
	}
	.search-field input, .url-row input {
		min-width: 0;
		flex: 1;
		border: 0;
		background: transparent;
		font-size: 11px;
		color: var(--text-primary);
		outline: none;
	}
	.model-list { max-height: 260px; overflow-y: auto; padding-top: 4px; }
	.model-option {
		display: grid;
		width: 100%;
		grid-template-columns: minmax(0, 1fr);
		gap: 1px;
		border-radius: 5px;
		padding: 6px 7px;
		text-align: left;
		font-size: 11px;
		color: var(--text-secondary);
	}
	.model-option:hover { background: var(--bg-hover); color: var(--text-primary); }
	.model-option--active { background: var(--brand-bg); color: var(--brand-muted-fg); }
	.model-option:disabled { cursor: not-allowed; opacity: 0.38; }
	.empty-row { padding: 14px 8px; text-align: center; font-size: 11px; color: var(--text-tertiary); }
	.reference-popover { left: 0; width: min(310px, calc(100vw - 32px)); padding: 6px; }
	.media-segments { display: flex; gap: 2px; margin-bottom: 6px; }
	.media-segments button { display: flex; width: 28px; height: 26px; align-items: center; justify-content: center; border-radius: 5px; color: var(--text-tertiary); }
	.media-segments button:hover { background: var(--bg-hover); color: var(--text-primary); }
	.media-segments button.active { background: var(--brand-bg); color: var(--brand-muted-fg); }
	.url-row { display: flex; align-items: center; gap: 4px; border: 1px solid var(--border-subtle); border-radius: 6px; padding-left: 8px; }
	.settings-popover {
		left: 0;
		width: min(300px, calc(100vw - 32px));
		max-height: 310px;
		overflow-y: auto;
		padding: 5px;
	}
	.parameter-row {
		display: grid;
		min-height: 34px;
		grid-template-columns: minmax(0, 1fr) minmax(90px, 140px);
		align-items: center;
		gap: 10px;
		padding: 3px 5px;
		font-size: 11px;
		text-transform: capitalize;
		color: var(--text-secondary);
	}
	.parameter-row input:not([type="checkbox"]), .parameter-row select {
		min-width: 0;
		height: 26px;
		border: 1px solid var(--border-subtle);
		border-radius: 5px;
		background: var(--bg-input);
		padding: 0 6px;
		font-size: 10px;
		color: var(--text-primary);
		outline: none;
	}
	.parameter-row input[type="checkbox"] { justify-self: end; accent-color: var(--brand); }
	@media (pointer: coarse) {
		.generation-wrap { bottom: calc(64px + env(safe-area-inset-bottom, 0px)); }
		.icon-btn, .submit-btn { width: 36px; height: 36px; }
		.model-btn { min-width: 0; height: 36px; max-width: 150px; }
		.composer-footer { min-height: 48px; }
		.mini-btn { width: 28px; height: 28px; }
	}
	@media (max-width: 520px) {
		.generation-wrap { width: calc(100% - 16px); }
		.generation-composer { border-radius: 8px; }
		.error-text { max-width: 110px; }
		.reference-anchor, .settings-anchor { position: static; }
		.reference-popover, .settings-popover {
			left: 8px;
			right: 8px;
			bottom: 48px;
			width: auto;
		}
	}
</style>
