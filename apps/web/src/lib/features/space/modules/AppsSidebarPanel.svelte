<script lang="ts">
import {
	marketplaceEntryToInstalledApp,
	type AppMarketplaceCatalog,
	type AppMarketplaceEntry,
	type InstalledApp,
	type SpaceInstalledApps,
} from "@cohub/protocol";
import type { AppRecord } from "@neta-art/cohub";
import {
	AlertCircle,
	Box,
	Loader2,
	PackagePlus,
	RefreshCw,
	Rocket,
	Search,
	Store,
	Trash2,
} from "lucide-svelte";
import { onMount } from "svelte";
import {
	APPS_CHANGED_EVENT,
	type AppsChangedDetail,
	upsertAppSnapshot,
} from "$lib/features/app/app-realtime";
import {
	loadAppMarketplace,
	readInstalledApps,
	searchMarketplace,
	writeInstalledApps,
	type InstalledAppsFile,
} from "$lib/features/app/app-center";
import { sdk } from "$lib/sdk";

type View = "installed" | "published" | "marketplace";

type Props = {
	spaceId: string;
	canWrite: boolean;
	onOpenPublished: (app: AppRecord) => void;
	onOpenInstalled: (app: InstalledApp) => void;
};

let { spaceId, canWrite, onOpenPublished, onOpenInstalled }: Props = $props();

let view = $state<View>("installed");
let installedFile = $state<InstalledAppsFile | null>(null);
let installedLoading = $state(false);
let installedError = $state("");
let mutationId = $state<string | null>(null);
let published = $state<AppRecord[]>([]);
let publishedLoading = $state(false);
let publishedError = $state("");
let marketplace = $state<AppMarketplaceCatalog | null>(null);
let marketplaceLoading = $state(false);
let marketplaceError = $state("");
let query = $state("");
let installedLoadedFor = $state<string | null>(null);
let installedRequestToken = 0;
let installedMutationToken = 0;
let publishedLoadedFor = $state<string | null>(null);
let publishedRequestToken = 0;
let publishedLoadingSpaceId: string | null = null;
let stateSpaceId: string | null = null;

const installed = $derived(installedFile?.document.apps ?? []);
const installedIds = $derived(new Set(installed.map((app) => app.id)));
const marketplaceResults = $derived(
	searchMarketplace(marketplace?.apps ?? [], query),
);

function errorMessage(error: unknown, fallback: string) {
	return error instanceof Error ? error.message : fallback;
}

async function loadInstalled() {
	const requestSpaceId = spaceId;
	const requestToken = ++installedRequestToken;
	installedLoading = true;
	installedError = "";
	try {
		const nextFile = await readInstalledApps(requestSpaceId);
		if (spaceId !== requestSpaceId || installedRequestToken !== requestToken) return;
		installedFile = nextFile;
		installedLoadedFor = requestSpaceId;
	} catch (error) {
		if (spaceId !== requestSpaceId || installedRequestToken !== requestToken) return;
		installedError = errorMessage(error, "Failed to load installed Apps.");
	} finally {
		if (spaceId === requestSpaceId && installedRequestToken === requestToken) {
			installedLoading = false;
		}
	}
}

async function loadPublished() {
	const requestSpaceId = spaceId;
	if (publishedLoading && publishedLoadingSpaceId === requestSpaceId) return;
	const requestToken = ++publishedRequestToken;
	publishedLoading = true;
	publishedLoadingSpaceId = requestSpaceId;
	publishedError = "";
	try {
		const result = await sdk.apps.listBySpace(requestSpaceId);
		if (spaceId !== requestSpaceId || publishedRequestToken !== requestToken) return;
		published = result.apps;
		publishedLoadedFor = requestSpaceId;
	} catch (error) {
		if (spaceId !== requestSpaceId || publishedRequestToken !== requestToken) return;
		publishedError = errorMessage(error, "Failed to load published Apps.");
	} finally {
		if (spaceId === requestSpaceId && publishedRequestToken === requestToken) {
			publishedLoading = false;
			publishedLoadingSpaceId = null;
		}
	}
}

async function loadMarketplace(refresh = false) {
	if (marketplaceLoading) return;
	marketplaceLoading = true;
	marketplaceError = "";
	try {
		marketplace = await loadAppMarketplace({ refresh });
	} catch (error) {
		marketplaceError = errorMessage(error, "Failed to load Marketplace.");
	} finally {
		marketplaceLoading = false;
	}
}

function selectView(next: View) {
	view = next;
	if (next === "published" && publishedLoadedFor !== spaceId) void loadPublished();
	if (next === "marketplace" && !marketplace) void loadMarketplace();
}

async function persist(
	key: string,
	update: (document: SpaceInstalledApps) => SpaceInstalledApps,
) {
	if (!installedFile || mutationId || !canWrite) return false;
	const requestSpaceId = spaceId;
	const requestToken = ++installedMutationToken;
	const previous = installedFile;
	const next = update(previous.document);
	const isCurrent = () =>
		spaceId === requestSpaceId && installedMutationToken === requestToken;
	mutationId = key;
	installedError = "";
	installedFile = { ...previous, document: next };
	try {
		const revision = await writeInstalledApps(
			requestSpaceId,
			next,
			previous.revision,
		);
		if (!isCurrent()) return false;
		installedFile = { document: next, revision };
		return true;
	} catch (error) {
		if (!isCurrent()) return false;
		installedFile = previous;
		installedError = `${errorMessage(error, "Failed to update installed Apps.")} Refresh before trying again.`;
		return false;
	} finally {
		if (isCurrent()) mutationId = null;
	}
}

async function install(app: AppMarketplaceEntry) {
	if (installedIds.has(app.id)) return;
	const installedApp = marketplaceEntryToInstalledApp(app);
	const saved = await persist(`install:${app.id}`, (document) => ({
		...document,
		apps: [...document.apps, installedApp],
	}));
	if (saved) view = "installed";
}

function setEnabled(app: InstalledApp, enabled: boolean) {
	void persist(`toggle:${app.id}`, (document) => ({
		...document,
		apps: document.apps.map((item) =>
			item.id === app.id ? { ...item, enabled } : item,
		),
	}));
}

function uninstall(app: InstalledApp) {
	if (!confirm(`Uninstall ${app.snapshot.name}?`)) return;
	void persist(`remove:${app.id}`, (document) => ({
		...document,
		apps: document.apps.filter((item) => item.id !== app.id),
	}));
}

function openInstalled(app: InstalledApp) {
	onOpenInstalled(app);
}

$effect(() => {
	if (stateSpaceId === spaceId) return;
	stateSpaceId = spaceId;
	installedMutationToken += 1;
	mutationId = null;
	installedFile = null;
	installedLoadedFor = null;
	published = [];
	publishedLoadedFor = null;
	void loadInstalled();
	if (view === "published") void loadPublished();
});

onMount(() => {
	const onAppsChanged = (event: Event) => {
		const detail = (event as CustomEvent<AppsChangedDetail>).detail;
		if (detail?.spaceId !== spaceId) return;
		if (detail.app) {
			published = upsertAppSnapshot(published, detail.app);
			return;
		}
		if (detail.deletedAppId) {
			published = published.filter((app) => app.id !== detail.deletedAppId);
			return;
		}
		if (publishedLoadedFor === spaceId) void loadPublished();
	};
	window.addEventListener(APPS_CHANGED_EVENT, onAppsChanged);
	return () => window.removeEventListener(APPS_CHANGED_EVENT, onAppsChanged);
});
</script>

<div class="flex h-full min-h-0 flex-col bg-bg-primary">
	<div class="border-b border-border-subtle px-3 pb-2 pt-3">
		<div class="mb-3 flex items-center justify-between gap-2 px-1">
			<div class="min-w-0">
				<div class="text-[13px] font-semibold text-text-primary">Apps</div>
				<div class="mt-0.5 truncate text-[11px] text-text-placeholder">
					Space tools and published surfaces
				</div>
			</div>
			<button
				type="button"
				class="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[5px] text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-primary disabled:opacity-40"
				title="Refresh"
				aria-label="Refresh Apps"
				disabled={installedLoading || publishedLoading || marketplaceLoading}
				onclick={() => {
					if (view === "installed") void loadInstalled();
					else if (view === "published") void loadPublished();
					else void loadMarketplace(true);
				}}
			>
				<RefreshCw class={`${installedLoading || publishedLoading || marketplaceLoading ? "animate-spin" : ""} h-3.5 w-3.5`} />
			</button>
		</div>
		<div class="grid grid-cols-3 gap-1 rounded-[6px] bg-bg-elevated/50 p-1" role="tablist" aria-label="App sources">
			{#each [["installed", "Installed"], ["published", "Published"], ["marketplace", "Market"]] as tab}
				<button
					type="button"
					role="tab"
					aria-selected={view === tab[0]}
					class="min-h-8 rounded-[4px] px-2 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand {view === tab[0] ? 'bg-bg-primary text-text-primary shadow-sm' : 'text-text-tertiary hover:text-text-secondary'}"
					onclick={() => selectView(tab[0] as View)}
				>{tab[1]}</button>
			{/each}
		</div>
	</div>

	{#if view === "marketplace"}
		<div class="border-b border-border-subtle px-3 py-2.5">
			<label class="relative block">
				<span class="sr-only">Search Marketplace</span>
				<Search class="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-placeholder" />
				<input
					type="search"
					bind:value={query}
					placeholder="Search Apps"
					class="h-9 w-full rounded-[5px] border border-border-subtle bg-bg-input pl-8 pr-3 text-[12px] text-text-primary outline-none transition-colors placeholder:text-text-placeholder focus:border-brand/50"
				/>
			</label>
		</div>
	{/if}

	<div class="min-h-0 flex-1 overflow-y-auto px-2 py-2">
		{#if installedError && view === "installed"}
			<div class="mb-2 flex items-start gap-2 rounded-[5px] bg-error-bg px-2.5 py-2 text-[11px] leading-4 text-error-soft">
				<AlertCircle class="mt-0.5 h-3.5 w-3.5 shrink-0" />
				<span>{installedError}</span>
			</div>
		{/if}

		{#if view === "installed"}
			{#if installedLoading && !installedFile}
				<div class="flex h-28 items-center justify-center"><Loader2 class="h-4 w-4 animate-spin text-text-placeholder" /></div>
			{:else if installed.length === 0}
				<div class="flex min-h-48 flex-col items-center justify-center px-5 text-center">
					<Box class="mb-3 h-5 w-5 text-text-placeholder" />
					<div class="text-[12px] font-medium text-text-secondary">No installed Apps</div>
					<button type="button" class="mt-3 text-[11px] font-medium text-brand hover:text-brand-hover" onclick={() => selectView("marketplace")}>Browse Marketplace</button>
				</div>
			{:else}
				<div class="divide-y divide-border-subtle/70">
					{#each installed as app (app.id)}
						<div class="group flex min-w-0 items-center gap-2.5 px-2 py-2.5" class:opacity-60={!app.enabled}>
							{#if app.snapshot.icon}
								<img src={app.snapshot.icon} alt="" class="h-8 w-8 shrink-0 rounded-[6px] object-cover ring-1 ring-border-subtle" />
							{:else}
								<div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] bg-bg-elevated text-text-tertiary"><Box class="h-4 w-4" /></div>
							{/if}
							<button type="button" class="min-w-0 flex-1 text-left" disabled={!app.enabled} onclick={() => openInstalled(app)}>
								<div class="truncate text-[12px] font-medium text-text-primary">{app.snapshot.name}</div>
								<div class="mt-0.5 truncate font-mono text-[10px] text-text-placeholder">{app.ref}</div>
							</button>
							<div class="flex shrink-0 items-center gap-0.5">
								<label class="inline-flex h-8 w-8 cursor-pointer items-center justify-center" title={app.enabled ? "Disable" : "Enable"}>
									<input type="checkbox" class="sr-only" checked={app.enabled} disabled={!canWrite || Boolean(mutationId)} onchange={(event) => setEnabled(app, event.currentTarget.checked)} />
									<span class="h-3.5 w-6 rounded-full p-0.5 transition-colors {app.enabled ? 'bg-brand' : 'bg-bg-elevated'}"><span class="block h-2.5 w-2.5 rounded-full bg-brand-contrast-fg transition-transform {app.enabled ? 'translate-x-2.5' : ''}"></span></span>
								</label>
								<button type="button" class="inline-flex h-8 w-8 items-center justify-center rounded-[5px] text-text-placeholder transition-colors hover:bg-bg-hover hover:text-error-soft disabled:opacity-40" title="Uninstall" aria-label={`Uninstall ${app.snapshot.name}`} disabled={!canWrite || Boolean(mutationId)} onclick={() => uninstall(app)}><Trash2 class="h-3.5 w-3.5" /></button>
							</div>
						</div>
					{/each}
				</div>
			{/if}
		{:else if view === "published"}
			{#if publishedError}
				<div class="flex items-start gap-2 rounded-[5px] bg-error-bg px-2.5 py-2 text-[11px] leading-4 text-error-soft"><AlertCircle class="mt-0.5 h-3.5 w-3.5 shrink-0" /><span>{publishedError}</span></div>
			{:else if publishedLoading && publishedLoadedFor !== spaceId}
				<div class="flex h-28 items-center justify-center"><Loader2 class="h-4 w-4 animate-spin text-text-placeholder" /></div>
			{:else if published.length === 0}
				<div class="flex min-h-48 flex-col items-center justify-center px-5 text-center"><Rocket class="mb-3 h-5 w-5 text-text-placeholder" /><div class="text-[12px] font-medium text-text-secondary">No published Apps</div><div class="mt-1 text-[11px] leading-4 text-text-placeholder">Publish a file, directory, or port from Files.</div></div>
			{:else}
				<div class="divide-y divide-border-subtle/70">
					{#each published as app (app.id)}
						<button type="button" class="flex w-full min-w-0 items-center gap-2.5 rounded-[5px] px-2 py-2.5 text-left transition-colors hover:bg-bg-hover" onclick={() => onOpenPublished(app)}>
							<div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] bg-bg-elevated text-text-tertiary"><Rocket class="h-4 w-4" /></div>
							<div class="min-w-0 flex-1"><div class="truncate text-[12px] font-medium text-text-primary">{app.meta?.title ?? app.slug}</div><div class="mt-0.5 truncate font-mono text-[10px] text-text-placeholder">{app.slug}</div></div>
							<span class="h-1.5 w-1.5 shrink-0 rounded-full {app.status === 'published' ? 'bg-status-running' : 'bg-text-placeholder'}" title={app.status}></span>
						</button>
					{/each}
				</div>
			{/if}
		{:else}
			{#if marketplaceError}
				<div class="flex items-start gap-2 rounded-[5px] bg-error-bg px-2.5 py-2 text-[11px] leading-4 text-error-soft"><AlertCircle class="mt-0.5 h-3.5 w-3.5 shrink-0" /><span>{marketplaceError}</span></div>
			{:else if marketplaceLoading && !marketplace}
				<div class="flex h-28 items-center justify-center"><Loader2 class="h-4 w-4 animate-spin text-text-placeholder" /></div>
			{:else if marketplaceResults.length === 0}
				<div class="flex min-h-48 flex-col items-center justify-center px-5 text-center"><Store class="mb-3 h-5 w-5 text-text-placeholder" /><div class="text-[12px] font-medium text-text-secondary">{query ? "No matching Apps" : "Marketplace is empty"}</div></div>
			{:else}
				<div class="divide-y divide-border-subtle/70">
					{#each marketplaceResults as app (app.id)}
						<div class="flex min-w-0 items-start gap-2.5 px-2 py-3">
							{#if app.icon}<img src={app.icon} alt="" class="h-9 w-9 shrink-0 rounded-[6px] object-cover ring-1 ring-border-subtle" />{:else}<div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-[6px] bg-bg-elevated text-text-tertiary"><Store class="h-4 w-4" /></div>{/if}
							<div class="min-w-0 flex-1"><div class="truncate text-[12px] font-medium text-text-primary">{app.name}</div>{#if app.description}<div class="mt-0.5 line-clamp-2 text-[11px] leading-4 text-text-tertiary">{app.description}</div>{/if}<div class="mt-1 truncate font-mono text-[10px] text-text-placeholder">{app.ref}</div></div>
							{#if installedIds.has(app.id)}
								<span class="mt-0.5 shrink-0 text-[10px] font-medium text-success-soft">Installed</span>
							{:else}
								<button type="button" class="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[5px] bg-brand-muted text-brand transition-colors hover:bg-brand-muted-hover disabled:opacity-40" title="Install" aria-label={`Install ${app.name}`} disabled={!canWrite || Boolean(mutationId)} onclick={() => void install(app)}>{#if mutationId === `install:${app.id}`}<Loader2 class="h-3.5 w-3.5 animate-spin" />{:else}<PackagePlus class="h-3.5 w-3.5" />{/if}</button>
							{/if}
						</div>
					{/each}
				</div>
			{/if}
		{/if}
	</div>

	{#if !canWrite && view === "installed"}
		<div class="border-t border-border-subtle px-3 py-2 text-[10px] text-text-placeholder">Read-only Space</div>
	{/if}
</div>
