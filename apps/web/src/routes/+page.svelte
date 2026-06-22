<script lang="ts">
import {
	ArrowRight,
	Bot,
	Compass,
	Globe,
	Layers3,
	LogIn,
	MessageSquare,
	Music3,
	Palette,
	Play,
	Sparkles,
	Terminal,
	Users,
	Video,
	Workflow,
} from "lucide-svelte";
import { onMount } from "svelte";
import { goto } from "$app/navigation";
import { signInWithRedirectPath } from "$lib/auth";
import CenteredLoading from "$lib/components/CenteredLoading.svelte";
import { sdk } from "$lib/sdk";
import { buildSpaceLandingRoute } from "$lib/space-routes";
import { authStore } from "$lib/stores/auth.svelte";
import { setCachedSpaceList } from "$lib/stores/space-list-cache";

let isLoading = $state(true);
let isAuthenticated = $state(false);
let spaceCount = $state(0);

async function handlePrimaryCta() {
	try {
		await authStore.ensureLoaded(true);
		if (authStore.isAuthenticated) {
			await goto("/spaces/new");
			return;
		}
		await signInWithRedirectPath("/spaces/new");
	} catch (error) {
		console.error("[home] Failed to start Cohub:", error);
	}
}

onMount(async () => {
	await authStore.ensureLoaded(true);
	isAuthenticated = authStore.isAuthenticated;
	if (!authStore.isAuthenticated) {
		isLoading = false;
		return;
	}

	try {
		const spaces = setCachedSpaceList(await sdk.spaces.list());
		spaceCount = spaces.length;
		if (spaces.length > 0) {
			await goto(buildSpaceLandingRoute(spaces[0].id));
			return;
		}
	} catch {
		// Keep the landing page usable even if space loading fails.
	} finally {
		isLoading = false;
	}
});
</script>

<svelte:head>
	<title>Cohub</title>
	<meta
		name="description"
		content="A shared creative space for people and agents to create, play, and build together."
	/>
</svelte:head>

{#if isLoading}
	<div class="flex min-h-0 flex-1 items-center justify-center">
		<CenteredLoading label="Loading..." size="compact" />
	</div>
{:else if spaceCount > 0}
	<div class="flex min-h-0 flex-1 items-center justify-center">
		<CenteredLoading label="Redirecting..." size="compact" />
	</div>
{:else}
	<div class="flex min-h-0 flex-1 flex-col overflow-y-auto bg-bg-primary">
		<header class="sticky top-0 z-20 border-b border-border-subtle bg-bg-primary/88 backdrop-blur-md">
			<div class="mx-auto flex w-full max-w-7xl items-center justify-between gap-3 px-4 py-3.5 sm:px-6 lg:px-8">
				<a href="/" class="inline-flex min-w-0 items-center gap-3 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60">
					<div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px] border border-border-subtle bg-bg-surface text-[14px] font-semibold text-brand shadow-sm">
						C
					</div>
					<div class="min-w-0 leading-tight">
						<div class="text-[13px] font-semibold text-text-primary">Cohub</div>
						<div class="hidden text-[11px] text-text-tertiary sm:block">Create with people and agents</div>
					</div>
				</a>

				<nav class="flex shrink-0 items-center gap-1.5 text-[13px] sm:gap-2">
					<a
						href="/explore?view=wall"
						class="inline-flex items-center gap-2 rounded-full border border-border-subtle bg-bg-surface px-3 py-2 text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60"
					>
						<Compass class="h-3.5 w-3.5" />
						<span class="hidden xs:inline sm:inline">Explore</span>
					</a>
					<a
						href="/pricing"
						class="inline-flex items-center rounded-full border border-border-subtle bg-bg-surface px-3 py-2 text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60"
					>
						Pricing
					</a>
					<button
						type="button"
						onclick={handlePrimaryCta}
						class="inline-flex items-center gap-2 rounded-full bg-brand px-3.5 py-2 text-[13px] font-medium text-brand-contrast-fg transition-colors hover:bg-brand-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/70 sm:px-4"
					>
						<LogIn class="hidden h-3.5 w-3.5 sm:block" />
						Start
					</button>
				</nav>
			</div>
		</header>

		<main class="flex-1">
			<section class="relative overflow-hidden">
				<div class="pointer-events-none absolute inset-x-0 top-0 h-72 bg-[radial-gradient(circle_at_20%_0%,color-mix(in_srgb,var(--brand)_13%,transparent),transparent_58%)]"></div>
				<div class="mx-auto grid w-full max-w-7xl gap-9 px-4 pb-8 pt-9 sm:px-6 sm:pb-12 sm:pt-14 lg:grid-cols-[1.04fr_0.96fr] lg:items-center lg:gap-12 lg:px-8 lg:pb-16 lg:pt-18">
					<div class="relative max-w-2xl">
						<div class="inline-flex items-center gap-2 rounded-full border border-brand-border bg-brand-muted px-3 py-1.5 text-[11px] font-medium text-brand shadow-sm">
							<Sparkles class="h-3.5 w-3.5" />
							Fun, shared, open, powerful
						</div>
						<h1 class="mt-5 text-[clamp(2.5rem,12vw,5.5rem)] font-semibold leading-[0.94] tracking-[-0.055em] text-text-primary sm:leading-[0.92]">
							Your own space to create, play, and build with people and agents.
						</h1>
						<p class="mt-5 max-w-xl text-[15px] leading-7 text-text-tertiary sm:mt-6 sm:text-[16px]">
							Bring people, agents, files, models, and ideas into one living Space. Start anywhere, make with any medium, and turn fun experiments into shareable Works.
						</p>

						<div class="mt-7 flex flex-col gap-3 sm:mt-8 sm:flex-row sm:items-center">
							<button
								type="button"
								onclick={handlePrimaryCta}
								class="inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-brand px-5 py-3 text-[13px] font-medium text-brand-contrast-fg shadow-sm transition-colors hover:bg-brand-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/70"
							>
								<LogIn class="h-3.5 w-3.5" />
								Start a Space
							</button>
							<a
								href="/explore?view=wall"
								class="inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-border-subtle bg-bg-surface px-5 py-3 text-[13px] font-medium text-text-primary transition-colors hover:bg-bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60"
							>
								<Compass class="h-3.5 w-3.5" />
								Explore public Spaces
							</a>
							<a href="/pricing" class="inline-flex items-center justify-center gap-2 px-1 py-2 text-[13px] font-medium text-text-secondary transition-colors hover:text-text-primary">
								See pricing
								<ArrowRight class="h-3.5 w-3.5" />
							</a>
						</div>

						<div class="mt-7 flex flex-wrap gap-2 text-[12px] text-text-tertiary sm:mt-8">
							<span class="inline-flex items-center gap-1.5 rounded-full border border-border-subtle bg-bg-surface px-3 py-1.5"><Globe class="h-3.5 w-3.5 text-text-secondary" />Web</span>
							<span class="inline-flex items-center gap-1.5 rounded-full border border-border-subtle bg-bg-surface px-3 py-1.5"><Play class="h-3.5 w-3.5 text-text-secondary" />Mobile</span>
							<span class="inline-flex items-center gap-1.5 rounded-full border border-border-subtle bg-bg-surface px-3 py-1.5"><Terminal class="h-3.5 w-3.5 text-text-secondary" />CLI</span>
							<span class="inline-flex items-center gap-1.5 rounded-full border border-border-subtle bg-bg-surface px-3 py-1.5"><MessageSquare class="h-3.5 w-3.5 text-text-secondary" />Discord</span>
							<span class="inline-flex items-center gap-1.5 rounded-full border border-border-subtle bg-bg-surface px-3 py-1.5"><MessageSquare class="h-3.5 w-3.5 text-text-secondary" />WeChat</span>
						</div>
					</div>

					<div class="relative lg:pt-4">
						<div class="pointer-events-none absolute -inset-4 rounded-[34px] bg-[radial-gradient(circle_at_72%_18%,color-mix(in_srgb,var(--brand)_12%,transparent),transparent_48%)]"></div>
						<div class="relative rounded-[26px] border border-border-subtle bg-bg-surface/90 p-2.5 shadow-[0_26px_80px_-54px_color-mix(in_srgb,var(--text-primary)_45%,transparent)] sm:p-3.5">
							<div class="overflow-hidden rounded-[21px] border border-border-subtle bg-bg-primary">
								<div class="flex items-center justify-between gap-3 border-b border-border-subtle px-4 py-3">
									<div class="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-text-placeholder">
										<Users class="h-3.5 w-3.5 text-brand" />
										Shared Space preview
									</div>
									<div class="flex -space-x-1.5">
										<div class="h-5 w-5 rounded-full border border-bg-primary bg-brand-muted"></div>
										<div class="h-5 w-5 rounded-full border border-bg-primary bg-bg-hover"></div>
										<div class="flex h-5 w-5 items-center justify-center rounded-full border border-bg-primary bg-bg-content text-[9px] text-text-tertiary">AI</div>
									</div>
								</div>

								<div class="grid gap-3 p-3.5 sm:p-4 md:grid-cols-[1.02fr_0.98fr]">
									<div class="rounded-[19px] border border-border-subtle bg-bg-content p-3.5 sm:p-4">
										<div class="flex items-center justify-between gap-3">
											<div>
												<div class="text-[12px] font-medium text-text-primary">Image / video placeholder</div>
												<div class="mt-1 text-[11px] text-text-tertiary">Drop in your key visual here.</div>
											</div>
											<div class="rounded-full border border-brand-border bg-brand-muted px-2 py-1 text-[10px] font-medium text-brand">Live</div>
										</div>
										<div class="mt-4 aspect-[4/3] overflow-hidden rounded-[16px] border border-dashed border-border-subtle bg-[linear-gradient(145deg,color-mix(in_srgb,var(--brand)_8%,transparent),transparent_52%),linear-gradient(180deg,var(--bg-primary),var(--bg-surface))] p-3">
											<div class="flex h-full flex-col justify-between">
												<div class="flex items-center justify-between text-[10px] text-text-placeholder">
													<span>Workspace visual</span>
													<span>16:9</span>
												</div>
												<div class="space-y-2">
													<div class="h-2 w-24 rounded-full bg-bg-hover"></div>
													<div class="h-2 w-40 rounded-full bg-bg-hover"></div>
													<div class="h-2 w-28 rounded-full bg-bg-hover"></div>
												</div>
												<div class="flex items-center justify-between gap-2">
													<div class="flex -space-x-1">
														<div class="h-6 w-6 rounded-full border border-bg-primary bg-brand-muted"></div>
														<div class="h-6 w-6 rounded-full border border-bg-primary bg-bg-hover"></div>
														<div class="flex h-6 w-6 items-center justify-center rounded-full border border-bg-primary bg-bg-content text-[9px] text-brand">A</div>
													</div>
													<div class="flex items-center gap-2 rounded-full border border-border-subtle bg-bg-primary/80 px-3 py-1.5 text-[10px] text-text-secondary backdrop-blur-sm">
														<Play class="h-3 w-3 text-brand" />
														Preview
													</div>
												</div>
											</div>
										</div>
									</div>

									<div class="grid gap-3 sm:grid-cols-2 md:grid-cols-1">
										<div class="rounded-[18px] border border-border-subtle bg-bg-content p-4">
											<div class="flex items-center gap-2 text-[11px] uppercase tracking-[0.16em] text-text-placeholder">
												<Bot class="h-3.5 w-3.5 text-brand" />
												Agent ready
											</div>
											<p class="mt-3 text-[12px] leading-5 text-text-secondary">Chat, code, generate, and revise in the same context.</p>
										</div>
										<div class="rounded-[18px] border border-border-subtle bg-bg-content p-4">
											<div class="flex items-center gap-2 text-[11px] uppercase tracking-[0.16em] text-text-placeholder">
												<Layers3 class="h-3.5 w-3.5 text-brand" />
												Context stack
											</div>
											<p class="mt-3 text-[12px] leading-5 text-text-secondary">Spaces, checkpoints, works, and conversations stay linked.</p>
										</div>
										<div class="hidden rounded-[18px] border border-border-subtle bg-bg-content p-4 md:block">
											<div class="text-[11px] uppercase tracking-[0.16em] text-text-placeholder">Now making</div>
											<div class="mt-3 flex flex-wrap gap-1.5 text-[11px] text-text-secondary">
												<span class="rounded-full bg-bg-hover px-2 py-1">game</span>
												<span class="rounded-full bg-bg-hover px-2 py-1">video</span>
												<span class="rounded-full bg-bg-hover px-2 py-1">work</span>
											</div>
										</div>
									</div>
								</div>
							</div>
						</div>
					</div>
				</div>
			</section>

			<section class="mx-auto w-full max-w-7xl px-4 py-5 sm:px-6 sm:py-8 lg:px-8">
				<div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
					<div class="rounded-[22px] border border-border-subtle bg-bg-surface p-5 transition-colors hover:border-border-primary">
						<div class="flex h-9 w-9 items-center justify-center rounded-[12px] border border-brand-border bg-brand-muted text-brand"><Sparkles class="h-4 w-4" /></div>
						<h2 class="mt-4 text-[16px] font-semibold tracking-tight text-text-primary">Fun to start</h2>
						<p class="mt-2 text-[13px] leading-6 text-text-tertiary">Open a Space and start playing with ideas, prompts, media, files, and agents.</p>
					</div>
					<div class="rounded-[22px] border border-border-subtle bg-bg-surface p-5 transition-colors hover:border-border-primary">
						<div class="flex h-9 w-9 items-center justify-center rounded-[12px] border border-brand-border bg-brand-muted text-brand"><Users class="h-4 w-4" /></div>
						<h2 class="mt-4 text-[16px] font-semibold tracking-tight text-text-primary">Build and share together</h2>
						<p class="mt-2 text-[13px] leading-6 text-text-tertiary">Invite people and agents into the same context, co-create in one Space, and share what you make.</p>
					</div>
					<div class="rounded-[22px] border border-border-subtle bg-bg-surface p-5 transition-colors hover:border-border-primary">
						<div class="flex h-9 w-9 items-center justify-center rounded-[12px] border border-brand-border bg-brand-muted text-brand"><Globe class="h-4 w-4" /></div>
						<h2 class="mt-4 text-[16px] font-semibold tracking-tight text-text-primary">Open everywhere</h2>
						<p class="mt-2 text-[13px] leading-6 text-text-tertiary">Create from web, mobile, CLI, Discord, WeChat, and more - the Space stays with you.</p>
					</div>
					<div class="rounded-[22px] border border-border-subtle bg-bg-surface p-5 transition-colors hover:border-border-primary">
						<div class="flex h-9 w-9 items-center justify-center rounded-[12px] border border-brand-border bg-brand-muted text-brand"><Workflow class="h-4 w-4" /></div>
						<h2 class="mt-4 text-[16px] font-semibold tracking-tight text-text-primary">Powerful for real work</h2>
						<p class="mt-2 text-[13px] leading-6 text-text-tertiary">Build games, apps, media, automations, custom homes, and agent-powered experiences.</p>
					</div>
				</div>
			</section>

			<section class="mx-auto grid w-full max-w-7xl gap-4 px-4 py-6 sm:px-6 sm:py-10 lg:grid-cols-[0.95fr_1.05fr] lg:px-8">
				<div class="rounded-[26px] border border-border-subtle bg-bg-surface p-5 sm:p-6">
					<div class="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-text-placeholder">
						<Users class="h-3.5 w-3.5 text-brand" />
						Built together
					</div>
					<h2 class="mt-4 text-[clamp(1.5rem,2vw,2rem)] font-semibold tracking-tight text-text-primary">People and agents stay in the same room.</h2>
					<p class="mt-3 text-[14px] leading-7 text-text-tertiary">Share one context, co-edit the direction, and keep the full conversation history, files, and outputs attached to the Space.</p>
					<div class="mt-6 space-y-2">
						<div class="flex items-start gap-3 rounded-[16px] border border-border-subtle bg-bg-content px-4 py-3 text-[13px] text-text-secondary"><div class="mt-1 h-1.5 w-1.5 rounded-full bg-brand"></div><span>Chat with people and agents in one Space</span></div>
						<div class="flex items-start gap-3 rounded-[16px] border border-border-subtle bg-bg-content px-4 py-3 text-[13px] text-text-secondary"><div class="mt-1 h-1.5 w-1.5 rounded-full bg-brand"></div><span>Generate text, image, video, and music</span></div>
						<div class="flex items-start gap-3 rounded-[16px] border border-border-subtle bg-bg-content px-4 py-3 text-[13px] text-text-secondary"><div class="mt-1 h-1.5 w-1.5 rounded-full bg-brand"></div><span>Save checkpoints and fork the good parts</span></div>
						<div class="flex items-start gap-3 rounded-[16px] border border-border-subtle bg-bg-content px-4 py-3 text-[13px] text-text-secondary"><div class="mt-1 h-1.5 w-1.5 rounded-full bg-brand"></div><span>Publish Works from files, directories, or ports</span></div>
					</div>
				</div>

				<div class="grid gap-4 sm:grid-cols-2">
					<div class="rounded-[26px] border border-border-subtle bg-bg-surface p-5 sm:p-6">
						<div class="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-text-placeholder"><Video class="h-3.5 w-3.5 text-brand" />Open everywhere</div>
						<p class="mt-4 text-[14px] leading-7 text-text-tertiary">The Space follows you across web, mobile, CLI, and chat apps.</p>
						<div class="mt-5 flex flex-wrap gap-2">
							<span class="inline-flex items-center gap-1.5 rounded-full border border-border-subtle bg-bg-content px-3 py-1.5 text-[12px] text-text-secondary"><Globe class="h-3.5 w-3.5 text-text-tertiary" />Web</span>
							<span class="inline-flex items-center gap-1.5 rounded-full border border-border-subtle bg-bg-content px-3 py-1.5 text-[12px] text-text-secondary"><Play class="h-3.5 w-3.5 text-text-tertiary" />Mobile</span>
							<span class="inline-flex items-center gap-1.5 rounded-full border border-border-subtle bg-bg-content px-3 py-1.5 text-[12px] text-text-secondary"><Terminal class="h-3.5 w-3.5 text-text-tertiary" />CLI</span>
							<span class="inline-flex items-center gap-1.5 rounded-full border border-border-subtle bg-bg-content px-3 py-1.5 text-[12px] text-text-secondary"><MessageSquare class="h-3.5 w-3.5 text-text-tertiary" />Discord</span>
							<span class="inline-flex items-center gap-1.5 rounded-full border border-border-subtle bg-bg-content px-3 py-1.5 text-[12px] text-text-secondary"><MessageSquare class="h-3.5 w-3.5 text-text-tertiary" />WeChat</span>
						</div>
					</div>

					<div class="rounded-[26px] border border-border-subtle bg-bg-surface p-5 sm:p-6">
						<div class="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-text-placeholder"><Palette class="h-3.5 w-3.5 text-brand" />Powerful for real work</div>
						<p class="mt-4 text-[14px] leading-7 text-text-tertiary">From playful prototypes to complex games, apps, and agent-powered workflows.</p>
						<div class="mt-5 flex flex-wrap gap-2">
							<span class="inline-flex items-center gap-1.5 rounded-full border border-border-subtle bg-bg-content px-3 py-1.5 text-[12px] text-text-secondary"><Workflow class="h-3.5 w-3.5 text-text-tertiary" />Text</span>
							<span class="inline-flex items-center gap-1.5 rounded-full border border-border-subtle bg-bg-content px-3 py-1.5 text-[12px] text-text-secondary"><Palette class="h-3.5 w-3.5 text-text-tertiary" />Image</span>
							<span class="inline-flex items-center gap-1.5 rounded-full border border-border-subtle bg-bg-content px-3 py-1.5 text-[12px] text-text-secondary"><Video class="h-3.5 w-3.5 text-text-tertiary" />Video</span>
							<span class="inline-flex items-center gap-1.5 rounded-full border border-border-subtle bg-bg-content px-3 py-1.5 text-[12px] text-text-secondary"><Music3 class="h-3.5 w-3.5 text-text-tertiary" />Music</span>
						</div>
						<div class="mt-6 rounded-[18px] border border-dashed border-border-subtle bg-bg-primary p-4">
							<div class="text-[12px] font-medium text-text-primary">Image / video placeholder</div>
							<p class="mt-1 text-[12px] leading-6 text-text-tertiary">Reserve this area for a product demo, campaign video, or a polished visual of a living Space.</p>
						</div>
					</div>
				</div>
			</section>

			<section class="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 sm:py-10 lg:px-8">
				<div class="overflow-hidden rounded-[28px] border border-border-subtle bg-bg-surface">
					<div class="grid gap-6 px-5 py-8 sm:px-8 sm:py-10 lg:grid-cols-[1fr_auto] lg:items-center">
						<div>
							<div class="text-[11px] font-semibold uppercase tracking-[0.18em] text-text-placeholder">Context network</div>
							<h2 class="mt-3 text-[clamp(1.45rem,2vw,2.15rem)] font-semibold tracking-tight text-text-primary">Discover public Spaces, save checkpoints, and remix what already works.</h2>
							<p class="mt-3 max-w-2xl text-[14px] leading-7 text-text-tertiary">Cohub is not a blank-page tool. It is a network of shared context you can browse, fork, and build from.</p>
						</div>
						<div class="flex flex-wrap gap-2 text-[12px] text-text-secondary">
							<span class="rounded-full border border-border-subtle bg-bg-content px-3 py-1.5">Explore</span>
							<span class="rounded-full border border-border-subtle bg-bg-content px-3 py-1.5">Fork</span>
							<span class="rounded-full border border-border-subtle bg-bg-content px-3 py-1.5">Checkpoint</span>
							<span class="rounded-full border border-border-subtle bg-bg-content px-3 py-1.5">Works</span>
						</div>
					</div>
					<div class="border-t border-border-subtle px-5 py-5 sm:px-8 sm:py-6">
						<div class="grid gap-3 md:grid-cols-3">
							<div class="rounded-[18px] border border-border-subtle bg-bg-primary p-4 text-[13px] text-text-secondary">Community Spaces that are worth opening</div>
							<div class="rounded-[18px] border border-border-subtle bg-bg-primary p-4 text-[13px] text-text-secondary">Checkpoints you can save, share, and revisit</div>
							<div class="rounded-[18px] border border-border-subtle bg-bg-primary p-4 text-[13px] text-text-secondary">Works that can be opened directly in the browser</div>
						</div>
					</div>
				</div>
			</section>

			<section class="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 sm:py-12 lg:px-8 lg:py-16">
				<div class="rounded-[28px] border border-brand-border bg-brand-muted px-5 py-8 sm:px-8 sm:py-10">
					<div class="max-w-3xl">
						<div class="text-[11px] font-semibold uppercase tracking-[0.18em] text-brand">Get started</div>
						<h2 class="mt-3 text-[clamp(1.75rem,2.6vw,2.75rem)] font-semibold tracking-tight text-text-primary">Start in seconds. Stay for the context.</h2>
						<p class="mt-3 text-[14px] leading-7 text-text-secondary">Use Cohub to play, build, and share from one living Space.</p>
					</div>
					<div class="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
						<button
							type="button"
							onclick={handlePrimaryCta}
							class="inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-brand px-5 py-3 text-[13px] font-medium text-brand-contrast-fg transition-colors hover:bg-brand-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/70"
						>
							<LogIn class="h-3.5 w-3.5" />
							Start a Space
						</button>
						<a
							href="/explore?view=wall"
							class="inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-border-subtle bg-bg-primary px-5 py-3 text-[13px] font-medium text-text-primary transition-colors hover:bg-bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60"
						>
							<Compass class="h-3.5 w-3.5" />
							Explore public Spaces
						</a>
					</div>
				</div>
			</section>
		</main>
	</div>
{/if}
