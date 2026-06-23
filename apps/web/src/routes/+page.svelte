<script lang="ts">
import { ArrowRight } from "lucide-svelte";
import { onMount } from "svelte";
import { goto } from "$app/navigation";
import { page } from "$app/state";
import { signInWithRedirectPath } from "$lib/auth";
import CenteredLoading from "$lib/components/CenteredLoading.svelte";
import LandingDemo from "$lib/components/LandingDemo.svelte";
import { sdk } from "$lib/sdk";
import { buildSpaceLandingRoute } from "$lib/space-routes";
import { authStore } from "$lib/stores/auth.svelte";
import { setCachedSpaceList } from "$lib/stores/space-list-cache";

let isLoading = $state(true);
let isAuthenticated = $state(false);
let spaceCount = $state(0);

const canonicalUrl = $derived(`${page.url.origin}${page.url.pathname}`);

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
	<title>Cohub — create, play, and build with people and agents</title>
	<meta
		name="description"
		content="A living Space for people and agents to create, play, and build together. Start anywhere, make in any medium, share as Works."
	/>
	<link rel="canonical" href={canonicalUrl} />
	<meta property="og:type" content="website" />
	<meta property="og:site_name" content="Cohub" />
	<meta property="og:title" content="Cohub — create, play, and build with people and agents" />
	<meta
		property="og:description"
		content="A living Space for people and agents. Start anywhere, make in any medium, share as Works."
	/>
	<meta property="og:url" content={canonicalUrl} />
	<meta name="twitter:card" content="summary" />
	<meta name="twitter:title" content="Cohub — create, play, and build with people and agents" />
	<meta
		name="twitter:description"
		content="A living Space for people and agents. Start anywhere, make in any medium, share as Works."
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
		<!-- Ambient brand glow -->
		<div
			aria-hidden="true"
			class="pointer-events-none fixed inset-x-0 top-0 h-[480px] bg-[radial-gradient(circle_at_18%_-8%,color-mix(in_srgb,var(--brand)_14%,transparent),transparent_55%)]"
		></div>

		<!-- Header -->
		<header
			class="sticky top-0 z-30 border-b border-border-subtle bg-bg-primary/80 backdrop-blur-md"
		>
			<div
				class="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-5 py-3.5 sm:px-8"
			>
				<a href="/" class="inline-flex items-center gap-2.5 rounded-full">
					<div
						class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border-subtle bg-bg-surface text-[14px] font-semibold text-brand"
					>
						C
					</div>
					<span class="text-[15px] font-semibold tracking-tight text-text-primary">Cohub</span>
				</a>
				<nav class="flex items-center gap-1 text-[13px] sm:gap-2">
					<a
						href="/pricing"
						class="hidden rounded-full px-3 py-2 text-text-secondary transition-colors hover:text-text-primary sm:inline-block"
					>
						Pricing
					</a>
					<button
						type="button"
						onclick={handlePrimaryCta}
						class="inline-flex items-center gap-1.5 rounded-full bg-brand px-4 py-2 font-medium text-brand-contrast-fg transition-colors hover:bg-brand-hover"
					>
						Start
					</button>
				</nav>
			</div>
		</header>

		<main class="relative flex-1">
			<!-- Hero -->
			<section class="relative overflow-hidden">
				<div
					class="mx-auto grid w-full max-w-6xl gap-10 px-5 pb-20 pt-12 sm:px-8 sm:pt-16 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:gap-14 lg:pb-28 lg:pt-24"
				>
					<div class="relative max-w-xl">
						<div
							class="rise rise-1 inline-flex items-center gap-2 rounded-full border border-brand-border bg-brand-muted px-3 py-1 text-[11px] font-medium text-brand"
						>
							<span class="live-dot h-1.5 w-1.5 rounded-full bg-brand"></span>
							people + agents welcome
						</div>
						<h1
							class="rise rise-2 mt-6 text-[clamp(2.1rem,5.5vw,3.6rem)] font-semibold leading-[0.98] tracking-[-0.04em] text-text-primary"
						>
							Your own space to create, <span class="text-brand">play</span>, and build with
							people and agents.
						</h1>
						<p class="rise rise-3 mt-5 max-w-md text-[15px] leading-7 text-text-tertiary sm:text-[16px]">
							A living Space for people and agents. Start anywhere, make in any medium, share as
							Works.
						</p>
						<div class="rise rise-4 mt-8">
							<button
								type="button"
								onclick={handlePrimaryCta}
								class="inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-brand px-5 py-3 text-[13px] font-medium text-brand-contrast-fg transition-colors hover:bg-brand-hover"
							>
								Start a Space
								<ArrowRight class="h-3.5 w-3.5" />
							</button>
						</div>
					</div>

					<div class="rise rise-5 relative lg:pt-2">
						<LandingDemo label="hero" />
					</div>
				</div>
			</section>

			<!-- Five ideas -->
			<section class="mx-auto w-full max-w-6xl px-5 sm:px-8">
				<div class="divide-y divide-border-subtle">
					<!-- Fun to start — text left -->
					<div class="grid gap-8 py-14 lg:grid-cols-2 lg:items-center lg:gap-14 lg:py-20">
						<div>
							<h2
								class="text-[clamp(1.5rem,2.6vw,2.2rem)] font-semibold leading-tight tracking-tight text-text-primary"
							>
								Fun to start
							</h2>
							<p class="mt-3 max-w-md text-[15px] leading-7 text-text-tertiary">
								Open a Space and play with ideas, prompts, files, and agents.
							</p>
						</div>
						<LandingDemo label="fun to start" />
					</div>

					<!-- Build together — text right -->
					<div class="grid gap-8 py-14 lg:grid-cols-2 lg:items-center lg:gap-14 lg:py-20">
						<div class="lg:order-2">
							<h2
								class="text-[clamp(1.5rem,2.6vw,2.2rem)] font-semibold leading-tight tracking-tight text-text-primary"
							>
								Build together
							</h2>
							<p class="mt-3 max-w-md text-[15px] leading-7 text-text-tertiary">
								People and agents in one context. Co-create, save, and share.
							</p>
						</div>
						<div class="lg:order-1">
							<LandingDemo label="build together" />
						</div>
					</div>

					<!-- Open everywhere — text left -->
					<div class="grid gap-8 py-14 lg:grid-cols-2 lg:items-center lg:gap-14 lg:py-20">
						<div>
							<h2
								class="text-[clamp(1.5rem,2.6vw,2.2rem)] font-semibold leading-tight tracking-tight text-text-primary"
							>
								Open everywhere
							</h2>
							<p class="mt-3 max-w-md text-[15px] leading-7 text-text-tertiary">
								Web, mobile, CLI, Discord, WeChat. The Space follows you.
							</p>
						</div>
						<LandingDemo label="open everywhere" />
					</div>

					<!-- Powerful for real work — text right -->
					<div class="grid gap-8 py-14 lg:grid-cols-2 lg:items-center lg:gap-14 lg:py-20">
						<div class="lg:order-2">
							<h2
								class="text-[clamp(1.5rem,2.6vw,2.2rem)] font-semibold leading-tight tracking-tight text-text-primary"
							>
								Powerful for real work
							</h2>
							<p class="mt-3 max-w-md text-[15px] leading-7 text-text-tertiary">
								Games, apps, media, automations — from playful to production.
							</p>
						</div>
						<div class="lg:order-1">
							<LandingDemo label="powerful for real work" />
						</div>
					</div>

					<!-- Never start blank — text left -->
					<div class="grid gap-8 py-14 lg:grid-cols-2 lg:items-center lg:gap-14 lg:py-20">
						<div>
							<h2
								class="text-[clamp(1.5rem,2.6vw,2.2rem)] font-semibold leading-tight tracking-tight text-text-primary"
							>
								Never start blank
							</h2>
							<p class="mt-3 max-w-md text-[15px] leading-7 text-text-tertiary">
								Fork a checkpoint into a new Space, or reference any Space with
								<code class="font-mono text-[14px] text-brand">@space</code> as context.
							</p>
						</div>
						<LandingDemo label="never start blank" />
					</div>
				</div>
			</section>

			<!-- CTA -->
			<section class="mx-auto w-full max-w-6xl px-5 pb-24 pt-12 sm:px-8 lg:pb-32">
				<div class="rounded-2xl bg-brand px-6 py-12 sm:px-10 sm:py-14">
					<div class="max-w-2xl">
						<h2
							class="text-[clamp(1.6rem,2.6vw,2.4rem)] font-semibold tracking-tight text-brand-contrast-fg"
						>
							Start in seconds. Stay for the context.
						</h2>
						<p
							class="mt-3 text-[15px] leading-7 text-[color-mix(in_srgb,var(--brand-contrast-fg)_85%,transparent)]"
						>
							One Space to play, build, and share.
						</p>
					</div>
					<div class="mt-8">
						<button
							type="button"
							onclick={handlePrimaryCta}
							class="inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-brand-contrast-fg px-5 py-3 text-[13px] font-medium text-brand transition hover:brightness-95"
						>
							Start a Space
							<ArrowRight class="h-3.5 w-3.5" />
						</button>
					</div>
				</div>
			</section>
		</main>

		<!-- Footer -->
		<footer class="border-t border-border-subtle">
			<div class="mx-auto w-full max-w-6xl px-5 py-12 sm:px-8">
				<div class="grid gap-10 sm:grid-cols-2 lg:grid-cols-5">
					<div class="lg:col-span-2">
						<a href="/" class="inline-flex items-center gap-2.5">
							<div
								class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border-subtle bg-bg-surface text-[14px] font-semibold text-brand"
							>
								C
							</div>
							<span class="text-[15px] font-semibold tracking-tight text-text-primary"
								>Cohub</span
							>
						</a>
						<p class="mt-4 max-w-xs text-[13px] leading-6 text-text-tertiary">
							Create, play, and build with people and agents.
						</p>
					</div>

					<div>
						<div class="text-[11px] font-medium uppercase tracking-[0.14em] text-text-placeholder">
							Product
						</div>
						<ul class="mt-4 space-y-2.5 text-[13px]">
							<li>
								<span
									class="text-text-placeholder"
									title="Coming soon"
									>Features</span
								>
							</li>
							<li>
								<a
									href="/pricing"
									class="text-text-secondary transition-colors hover:text-text-primary"
									>Pricing</a
								>
							</li>
							<li>
								<span
									class="text-text-placeholder"
									title="Coming soon"
									>Changelog</span
								>
							</li>
						</ul>
					</div>

					<div>
						<div class="text-[11px] font-medium uppercase tracking-[0.14em] text-text-placeholder">
							Resources
						</div>
						<ul class="mt-4 space-y-2.5 text-[13px]">
							<li>
								<span
									class="text-text-placeholder"
									title="Coming soon"
									>Docs</span
								>
							</li>
							<li>
								<span
									class="text-text-placeholder"
									title="Coming soon"
									>Blog</span
								>
							</li>
							<li>
								<span
									class="text-text-placeholder"
									title="Coming soon"
									>Status</span
								>
							</li>
						</ul>
					</div>

					<div>
						<div class="text-[11px] font-medium uppercase tracking-[0.14em] text-text-placeholder">
							Legal
						</div>
						<ul class="mt-4 space-y-2.5 text-[13px]">
							<li>
								<span
									class="text-text-placeholder"
									title="Coming soon"
									>Privacy Policy</span
								>
							</li>
							<li>
								<span
									class="text-text-placeholder"
									title="Coming soon"
									>Terms of Use</span
								>
							</li>
							<li>
								<a
									href="mailto:hello@cohub.run"
									class="text-text-secondary transition-colors hover:text-text-primary"
									>hello@cohub.run</a
								>
							</li>
						</ul>
					</div>
				</div>

				<div
					class="mt-12 flex flex-col items-start justify-between gap-3 border-t border-border-subtle pt-6 text-[12px] text-text-tertiary sm:flex-row sm:items-center"
				>
					<span>© 2026 Cohub. All rights reserved.</span>
				</div>
			</div>
		</footer>
	</div>
{/if}

<style>
	@keyframes live-pulse {
		0%,
		100% {
			opacity: 1;
			transform: scale(1);
		}
		50% {
			opacity: 0.4;
			transform: scale(0.8);
		}
	}
	.live-dot {
		animation: live-pulse 2.4s cubic-bezier(0.4, 0, 0.6, 1) infinite;
	}

	@media (prefers-reduced-motion: no-preference) {
		.rise {
			opacity: 0;
			transform: translateY(10px);
			animation: rise-in 0.7s cubic-bezier(0.22, 0.61, 0.36, 1) forwards;
		}
		.rise-1 {
			animation-delay: 0.05s;
		}
		.rise-2 {
			animation-delay: 0.12s;
		}
		.rise-3 {
			animation-delay: 0.19s;
		}
		.rise-4 {
			animation-delay: 0.26s;
		}
		.rise-5 {
			animation-delay: 0.33s;
		}
	}
	@keyframes rise-in {
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.live-dot {
			animation: none;
		}
		.rise {
			opacity: 1;
			transform: none;
			animation: none;
		}
	}
</style>
