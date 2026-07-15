<script lang="ts">
import { ArrowRight } from "lucide-svelte";
import { onMount } from "svelte";
import { browser } from "$app/environment";
import { goto } from "$app/navigation";
import { page } from "$app/state";
import { hasLocalSessionHint, signInWithRedirectPath } from "$lib/auth";
import LandingDemo from "$lib/components/LandingDemo.svelte";
import PublicHeader from "$lib/components/PublicHeader.svelte";
import { sdk } from "$lib/sdk";
import { canonicalUrl as buildCanonical } from "$lib/seo";
import { buildSpaceLandingRoute } from "$lib/space-routes";
import { authStore } from "$lib/stores/auth.svelte";
import { getRecentSpace } from "$lib/stores/recent-space";
import {
	getCachedSpaceList,
	setCachedSpaceList,
} from "$lib/stores/space-list-cache";
import { getResolvedTheme } from "$lib/theme.svelte";

// Home marketing is always dark (app.html also forces it for first paint).
if (browser) {
	document.documentElement.setAttribute("data-theme", "dark");
}

/**
 * SSR always emits marketing HTML (SEO / no-JS).
 * Client: FOUC script may set data-home-redirect; we adopt that for UI state
 * without changing SSR markup structure (overlay + visibility, not if/else).
 */
function initialRedirectIntent(): boolean {
	if (!browser) return false;
	if (document.documentElement.getAttribute("data-home-redirect") === "1") {
		return true;
	}
	return hasLocalSessionHint();
}

let redirecting = $state(initialRedirectIntent());

const canonical = $derived(buildCanonical(page.url.origin, "/"));

function clearHomeRedirectAttr() {
	if (!browser) return;
	document.documentElement.removeAttribute("data-home-redirect");
}

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

async function resolveHomeDestination(): Promise<string> {
	const userKey = authStore.userUuid;
	if (userKey) {
		const recent = getRecentSpace(userKey);
		if (recent?.spaceId) return buildSpaceLandingRoute(recent.spaceId);
	}

	const cached = getCachedSpaceList();
	if (cached?.[0]?.id) return buildSpaceLandingRoute(cached[0].id);

	try {
		const spaces = setCachedSpaceList(await sdk.spaces.list());
		const defaultResult = await sdk.spaces.getDefault().catch(() => null);
		const targetSpace = defaultResult?.space ?? spaces[0] ?? null;
		if (targetSpace) return buildSpaceLandingRoute(targetSpace.id);
	} catch {
		// Authenticated with no reachable space → create flow.
	}

	return "/spaces/new";
}

onMount(() => {
	// Keep dark while on home; restore visitor theme when leaving.
	document.documentElement.setAttribute("data-theme", "dark");

	void (async () => {
		const maybeSession = redirecting || hasLocalSessionHint();
		if (!maybeSession) {
			clearHomeRedirectAttr();
			// Warm auth so Start is snappy; don't block marketing paint.
			void authStore.ensureLoaded(true);
			return;
		}

		redirecting = true;
		document.documentElement.setAttribute("data-home-redirect", "1");
		try {
			await authStore.ensureLoaded(true);
			if (!authStore.isAuthenticated) {
				redirecting = false;
				clearHomeRedirectAttr();
				return;
			}
			const dest = await resolveHomeDestination();
			await goto(dest);
		} catch (error) {
			console.warn("[home] Session redirect failed:", error);
			redirecting = false;
			clearHomeRedirectAttr();
		}
	})();

	return () => {
		document.documentElement.setAttribute("data-theme", getResolvedTheme());
	};
});
</script>

<svelte:head>
	<title>Cohub — create, play, and build with people and agents</title>
	<meta
		name="description"
		content="A living Space for people and agents to create, play, and build together. Start anywhere, make in any medium, share as Works."
	/>
	<link rel="canonical" href={canonical} />
	<meta property="og:type" content="website" />
	<meta property="og:site_name" content="Cohub" />
	<meta property="og:title" content="Cohub — create, play, and build with people and agents" />
	<meta
		property="og:description"
		content="A living Space for people and agents. Start anywhere, make in any medium, share as Works."
	/>
	<meta property="og:url" content={canonical} />
	<meta name="twitter:card" content="summary" />
	<meta name="twitter:title" content="Cohub — create, play, and build with people and agents" />
	<meta
		name="twitter:description"
		content="A living Space for people and agents. Start anywhere, make in any medium, share as Works."
	/>
</svelte:head>

<div class="relative min-h-screen">
	<!-- Always in DOM for crawlers; FOUC + redirecting hide for returning users. -->
	<div
		class="home-marketing flex min-h-0 flex-1 flex-col overflow-y-auto bg-bg-primary {redirecting
			? 'invisible pointer-events-none'
			: ''}"
		aria-hidden={redirecting ? "true" : undefined}
	>
		<!-- Ambient brand glow -->
		<div
			aria-hidden="true"
			class="pointer-events-none fixed inset-x-0 top-0 h-[480px] bg-[radial-gradient(circle_at_18%_-8%,color-mix(in_srgb,var(--brand)_14%,transparent),transparent_55%)]"
		></div>

		<!-- Header -->
		<PublicHeader sticky cta="start" onStart={handlePrimaryCta} />

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
								<a
									href="/changelog"
									class="text-text-secondary transition-colors hover:text-text-primary"
									>Changelog</a
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

	<!--
	  Always mounted so FOUC (data-home-redirect) can show it before hydration.
	  No crawlable copy — spinner only. Hidden unless redirecting / FOUC attr.
	-->
	<div
		class="home-redirect-shell absolute inset-0 z-50 min-h-screen items-center justify-center bg-bg-primary {redirecting
			? 'flex'
			: 'hidden'}"
		role="status"
		aria-live="polite"
		aria-busy={redirecting ? "true" : undefined}
		aria-hidden={redirecting ? undefined : "true"}
	>
		<span
			class="h-5 w-5 animate-spin rounded-full border-2 border-border-subtle border-t-brand"
			aria-label="Loading"
		></span>
	</div>
</div>

<style>
	/* Pre-hydration: app.html sets data-home-redirect when a session may exist. */
	:global(html[data-home-redirect="1"] .home-marketing) {
		visibility: hidden;
		pointer-events: none;
	}
	:global(html[data-home-redirect="1"] .home-redirect-shell) {
		display: flex !important;
	}
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
