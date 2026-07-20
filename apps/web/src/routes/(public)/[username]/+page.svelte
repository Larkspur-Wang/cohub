<script lang="ts">
import type {
	PublicUserPageResponse,
	PublicUserSpaceItem,
	PublicUserWorkItem,
} from "@neta-art/cohub";
import {
	ArrowUpRight,
	FolderKanban,
	Globe2,
	Lock,
	Sparkles,
} from "lucide-svelte";
import SpaceAvatar from "$lib/components/SpaceAvatar.svelte";
import UserAvatar from "$lib/components/UserAvatar.svelte";
import { sdk } from "$lib/sdk";
import { authStore } from "$lib/stores/auth.svelte";
import { formatCompactAbsoluteTime } from "$lib/time-format";

type ReadyData = { mode: "ready"; page: PublicUserPageResponse };
type ClientData = { mode: "client"; username: string };

const props = $props<{
	data: ReadyData | ClientData;
	params: { username: string };
}>();

/** Local revalidated snapshot; falls back to loader data. */
let refreshedPage = $state<PublicUserPageResponse | null>(null);
let clientError = $state("");
let clientLoading = $state(false);

const pageData = $derived(
	refreshedPage ?? (props.data.mode === "ready" ? props.data.page : null),
);

const profile = $derived(pageData?.profile ?? null);
const spaces = $derived(pageData?.spaces ?? []);
const works = $derived(pageData?.works ?? []);
const username = $derived(
	profile?.username ??
		(props.data.mode === "client"
			? props.data.username
			: props.params.username),
);
const isOwner = $derived(
	Boolean(
		authStore.userUuid &&
			profile?.userUuid &&
			authStore.userUuid === profile.userUuid,
	),
);
const spaceCountLabel = $derived(
	`${spaces.length} ${spaces.length === 1 ? "space" : "spaces"}`,
);
const workCountLabel = $derived(
	`${works.length} ${works.length === 1 ? "work" : "works"}`,
);
const pageTitle = $derived(
	profile
		? `${profile.displayName} (@${username}) — Cohub`
		: `@${username} — Cohub`,
);
const pageDescription = $derived(
	profile
		? `${profile.displayName} on Cohub · ${spaceCountLabel} · ${workCountLabel}`
		: `${username} on Cohub`,
);

function accessLabel(item: PublicUserSpaceItem) {
	return item.accessLabel === "public" ? "Public" : "Sign-in required";
}

function spaceUpdatedLabel(item: PublicUserSpaceItem) {
	if (!item.updatedAt) return null;
	const time = formatCompactAbsoluteTime(item.updatedAt);
	return time || null;
}

function workMeta(item: PublicUserWorkItem) {
	const parts = [item.spaceName || item.spaceSlug];
	const stamp = item.publishedAt ?? item.updatedAt;
	if (stamp) {
		const time = formatCompactAbsoluteTime(stamp);
		if (time) parts.push(time);
	}
	return parts.join(" · ");
}

$effect(() => {
	const routeUsername =
		props.data.mode === "client" ? props.data.username : props.params.username;
	const loaderPage = props.data.mode === "ready" ? props.data.page : null;
	refreshedPage = null;
	clientError = "";
	clientLoading = props.data.mode === "client";
	void authStore.ensureLoaded();
	// Silent revalidate after paint / username change. Also used as primary load
	// when SSR could not reach the public API.
	let cancelled = false;
	void sdk.users
		.getByUsername(routeUsername)
		.then((next) => {
			if (cancelled) return;
			refreshedPage = next;
			clientLoading = false;
		})
		.catch((err: unknown) => {
			if (cancelled) return;
			clientLoading = false;
			if (loaderPage) return;
			const status =
				err && typeof err === "object" && "status" in err
					? Number((err as { status?: unknown }).status)
					: 0;
			clientError =
				status === 404 ? "User not found." : "Failed to load profile.";
		});
	return () => {
		cancelled = true;
		void loaderPage;
	};
});
</script>

<svelte:head>
	<title>{pageTitle}</title>
	<meta name="description" content={pageDescription} />
	{#if !profile}
		<meta name="robots" content="noindex,nofollow" />
	{/if}
	<meta property="og:type" content="profile" />
	<meta property="og:site_name" content="Cohub" />
	<meta property="og:title" content={pageTitle} />
	<meta property="og:description" content={pageDescription} />
	<meta name="twitter:card" content="summary" />
	<meta name="twitter:title" content={pageTitle} />
	<meta name="twitter:description" content={pageDescription} />
</svelte:head>

<div class="min-h-screen bg-bg-primary">
	<div class="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6 sm:py-14">
		<a
			href="/"
			class="mb-10 inline-flex h-8 w-8 items-center justify-center rounded-[6px] bg-brand text-[11px] font-bold text-brand-contrast-fg"
			aria-label="Cohub home"
		>
			C
		</a>

		{#if !profile}
			<div class="rounded-[12px] border border-border-subtle bg-bg-surface px-4 py-8 text-center text-[13px] text-text-secondary">
				{#if clientLoading}
					Loading profile…
				{:else}
					{clientError || "Profile is unavailable."}
				{/if}
			</div>
		{:else}
		<header class="border-b border-border-subtle pb-8">
			<div class="flex items-start gap-4 sm:gap-5">
				<UserAvatar
					name={profile.displayName}
					avatarUrl={profile.avatarUrl}
					size="lg"
					loading="eager"
					class="h-14 w-14 border-border-subtle sm:h-16 sm:w-16"
				/>
				<div class="min-w-0 flex-1 pt-0.5">
					<div class="flex flex-wrap items-start justify-between gap-3">
						<div class="min-w-0">
							<h1 class="truncate text-[22px] font-semibold tracking-tight text-text-primary sm:text-[24px]">
								{profile.displayName}
							</h1>
							<p class="mt-1 truncate text-[13px] text-text-tertiary">@{username}</p>
						</div>
						{#if isOwner}
							<a
								href="/settings/profile"
								class="inline-flex h-8 shrink-0 items-center rounded-[5px] border border-border-subtle bg-bg-surface px-3 text-[12px] font-medium text-text-secondary transition-colors hover:border-border-strong hover:bg-bg-hover hover:text-text-primary"
							>
								Edit profile
							</a>
						{/if}
					</div>
					<div class="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-text-tertiary">
						<span class="tabular-nums text-text-secondary">{spaceCountLabel}</span>
						<span class="text-text-placeholder">·</span>
						<span class="tabular-nums text-text-secondary">{workCountLabel}</span>
					</div>
				</div>
			</div>
		</header>

		<section class="border-b border-border-subtle py-8" aria-labelledby="spaces-heading">
			<div class="mb-4 flex items-end justify-between gap-3">
				<div>
					<div class="text-[11px] font-semibold uppercase tracking-[0.16em] text-text-placeholder">
						Spaces
					</div>
					<h2 id="spaces-heading" class="mt-1 text-[15px] font-medium text-text-primary">
						Public workspaces
					</h2>
				</div>
				<span class="text-[12px] tabular-nums text-text-tertiary">{spaces.length}</span>
			</div>

			{#if spaces.length === 0}
				<div class="rounded-[10px] border border-border-subtle bg-bg-surface px-4 py-6">
					<p class="text-[13px] text-text-secondary">No public spaces yet</p>
					<p class="mt-1 text-[12px] leading-5 text-text-tertiary">
						Discoverable spaces with guest or sign-in access will show up here.
					</p>
				</div>
			{:else}
				<ul class="divide-y divide-border-subtle border-y border-border-subtle">
					{#each spaces as space (space.id)}
						<li>
							<a
								href={space.spaceUrl}
								class="group flex items-start gap-3 py-3.5 transition-colors hover:bg-bg-hover/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/70 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-primary sm:gap-3.5"
								data-sveltekit-preload-data="hover"
							>
								<SpaceAvatar
									name={space.name}
									profile={space.publicProfile}
									size="md"
									class="mt-0.5 rounded-[10px]"
								/>
								<div class="min-w-0 flex-1">
									<div class="flex items-center gap-2">
										<span class="truncate text-[14px] font-medium text-text-primary group-hover:text-brand">
											{space.name}
										</span>
										{#if space.accessLabel === "public"}
											<Globe2 class="h-3.5 w-3.5 shrink-0 text-text-placeholder" />
										{:else}
											<Lock class="h-3.5 w-3.5 shrink-0 text-text-placeholder" />
										{/if}
									</div>
									{#if space.description}
										<p class="mt-1 line-clamp-2 text-[12px] leading-5 text-text-tertiary">
											{space.description}
										</p>
									{/if}
									<div class="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-text-tertiary">
										<span class="inline-flex items-center gap-1">
											<FolderKanban class="h-3 w-3" />
											{accessLabel(space)}
										</span>
										{#if spaceUpdatedLabel(space)}
											<span class="text-text-placeholder">·</span>
											<span>{spaceUpdatedLabel(space)}</span>
										{/if}
									</div>
								</div>
								<ArrowUpRight class="mt-1 h-3.5 w-3.5 shrink-0 text-text-placeholder opacity-0 transition-opacity group-hover:opacity-100" />
							</a>
						</li>
					{/each}
				</ul>
			{/if}
		</section>

		<section class="py-8" aria-labelledby="works-heading">
			<div class="mb-4 flex items-end justify-between gap-3">
				<div>
					<div class="text-[11px] font-semibold uppercase tracking-[0.16em] text-text-placeholder">
						Works
					</div>
					<h2 id="works-heading" class="mt-1 text-[15px] font-medium text-text-primary">
						Published works
					</h2>
				</div>
				<span class="text-[12px] tabular-nums text-text-tertiary">{works.length}</span>
			</div>

			{#if works.length === 0}
				<div class="rounded-[10px] border border-border-subtle bg-bg-surface px-4 py-6">
					<p class="text-[13px] text-text-secondary">No published works yet</p>
					<p class="mt-1 text-[12px] leading-5 text-text-tertiary">
						Public published works from this user will appear here.
					</p>
				</div>
			{:else}
				<ul class="divide-y divide-border-subtle border-y border-border-subtle">
					{#each works as work (work.id)}
						<li>
							<a
								href={work.publicUrl}
								class="group flex items-start gap-3 py-3.5 transition-colors hover:bg-bg-hover/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/70 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-primary"
								data-sveltekit-preload-data="hover"
							>
								{#if work.icon}
									<img
										src={work.icon}
										alt=""
										class="mt-0.5 h-9 w-9 shrink-0 rounded-[10px] border border-border-subtle bg-bg-surface object-cover"
										loading="lazy"
									/>
								{:else}
									<span class="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] border border-border-subtle bg-bg-surface text-text-tertiary">
										<Sparkles class="h-4 w-4" />
									</span>
								{/if}
								<div class="min-w-0 flex-1">
									<div class="truncate text-[14px] font-medium text-text-primary group-hover:text-brand">
										{work.title}
									</div>
									{#if work.description}
										<div class="mt-1 line-clamp-2 text-[12px] leading-5 text-text-secondary">
											{work.description}
										</div>
									{/if}
									<div class="mt-1 text-[11px] text-text-tertiary">
										{workMeta(work)}
									</div>
								</div>
								<ArrowUpRight class="mt-1 h-3.5 w-3.5 shrink-0 text-text-placeholder opacity-0 transition-opacity group-hover:opacity-100" />
							</a>
						</li>
					{/each}
				</ul>
			{/if}
		</section>
		{/if}
	</div>
</div>
