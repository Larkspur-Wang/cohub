<script lang="ts">
import { ArrowRight, Star } from "lucide-svelte";
import { onMount } from "svelte";
import { browser } from "$app/environment";
import { goto } from "$app/navigation";
import { page } from "$app/state";
import { resolveAppEntryRoute } from "$lib/app-entry";
import { hasLocalSessionHint, signInWithRedirectPath } from "$lib/auth";
import LandingMedia from "$lib/components/landing/LandingMedia.svelte";
import LandingProof from "$lib/components/landing/LandingProof.svelte";
import LandingSandboxSpec from "$lib/components/landing/LandingSandboxSpec.svelte";
import LandingSection from "$lib/components/landing/LandingSection.svelte";
import LandingTerminal from "$lib/components/landing/LandingTerminal.svelte";
import PublicHeader from "$lib/components/PublicHeader.svelte";
import { canonicalUrl as buildCanonical } from "$lib/seo";
import { authStore } from "$lib/stores/auth.svelte";
import { getResolvedTheme } from "$lib/theme.svelte";

// Marketing home renders light regardless of the visitor's app theme, so every
// product capture can be shot once. app.html sets this before first paint too.
if (browser) {
	document.documentElement.setAttribute("data-theme", "light");
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
			redirecting = true;
			if (browser)
				document.documentElement.setAttribute("data-home-redirect", "1");
			const dest = await resolveAppEntryRoute();
			if (dest) {
				await goto(dest);
				return;
			}
			redirecting = false;
			clearHomeRedirectAttr();
			console.error("[home] Authenticated but no default space available");
			return;
		}
		// After login, / resolves default (and ensures Home if needed).
		await signInWithRedirectPath("/");
	} catch (error) {
		redirecting = false;
		clearHomeRedirectAttr();
		console.error("[home] Failed to start Cohub:", error);
	}
}

onMount(() => {
	document.documentElement.setAttribute("data-theme", "light");

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
			const dest = await resolveAppEntryRoute();
			if (!dest) {
				redirecting = false;
				clearHomeRedirectAttr();
				console.warn("[home] No default space after ensure");
				return;
			}
			await goto(dest);
		} catch (error) {
			console.warn("[home] Session redirect failed:", error);
			redirecting = false;
			clearHomeRedirectAttr();
		}
	})();

	return () => {
		// Restore the visitor's own theme when leaving marketing.
		document.documentElement.setAttribute("data-theme", getResolvedTheme());
	};
});

/**
 * Verbatim CLI output from a Space driven from a terminal: a prompt goes out,
 * the agent edits a file, and that file is published as a new Work version.
 * Ids, sizes, and timestamps are exactly what the CLI printed — including the
 * full turn id, which wraps here the same way it wraps in a narrow terminal.
 */
const cliLines = [
	{
		kind: "out" as const,
		text: "export COHUB_SPACE_ID=39b1a22b-a635-4ef4-8a60-8106de0c5404",
		dim: true,
	},
	{ kind: "gap" as const },
	{
		kind: "command" as const,
		text: "cohub prompt",
		arg: '"Add a shooting star to demo/index.html"',
	},
	{
		kind: "ok" as const,
		text: "Prompt sent",
		detail: " — turnId: 63d24a41-9f95-4d30-810b-892270bab2c0",
	},
	{ kind: "gap" as const },
	{ kind: "command" as const, text: "cohub spaces files ls demo" },
	{
		kind: "out" as const,
		text: "Name         │ Type   │ Size   │ Modified",
		dim: true,
	},
	{
		kind: "out" as const,
		text: "index.html   │ file   │ 6666   │ 2026-08-12T17:37:10.462Z",
	},
	{ kind: "gap" as const },
	{
		kind: "command" as const,
		text: "cohub works publish starfield",
		flags: "--file demo/index.html --visibility public",
	},
	{ kind: "ok" as const, text: "Work version updated: v2" },
	{ kind: "gap" as const },
	{ kind: "command" as const, text: "cohub sandbox status" },
	{ kind: "out" as const, text: "provider: cloud", dim: true },
	{ kind: "out" as const, text: "status:   running", dim: true },
	{ kind: "gap" as const },
];
</script>

<svelte:head>
	<title>Cohub — a living space where people and agents build together</title>
	<meta
		name="description"
		content="A living space where people and agents create, play, and build together. Open a Space, work with an Agent on real files, save checkpoints, and publish live Works."
	/>
	<link rel="canonical" href={canonical} />
	<meta property="og:type" content="website" />
	<meta property="og:site_name" content="Cohub" />
	<meta property="og:title" content="Cohub — a living space where people and agents build together" />
	<meta
		property="og:description"
		content="Open a Space, build with an Agent on real files, save checkpoints, and publish live Works."
	/>
	<meta property="og:url" content={canonical} />
	<meta name="twitter:card" content="summary_large_image" />
	<meta name="twitter:title" content="Cohub — a living space where people and agents build together" />
	<meta
		name="twitter:description"
		content="Open a Space, build with an Agent on real files, save checkpoints, and publish live Works."
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
		<PublicHeader cta="start" onStart={handlePrimaryCta} />

		<main class="relative flex-1">
			<!-- 1 · Hero -->
			<section class="hero">
				<div class="mx-auto w-full max-w-6xl px-5 sm:px-8">
					<div class="mx-auto max-w-4xl text-center">
						<h1 class="hero-title">
							A living space where people and agents
							<span class="accent">create, play, and build</span> together.
						</h1>
						<p class="hero-lede">
							Open a Space and you get a real computer, an agent to work with, and room for
							friends to join in. Publish anything that comes out of it.
						</p>
						<div class="hero-actions">
							<button type="button" onclick={handlePrimaryCta} class="cta cta-primary group">
								Start a Space
								<ArrowRight class="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
							</button>
							<a
								href="https://github.com/talesofai/cohub"
								target="_blank"
								rel="noopener noreferrer"
								class="cta cta-secondary"
							>
								<Star class="h-4 w-4" />
								Star on GitHub
							</a>
						</div>
					</div>

					<div class="hero-media">
						<LandingMedia
							src="hero"
							alt="A Cohub Space with five people online, live messages drifting across the chat, forked sessions in the sidebar, and the file tree open"
							label="Hero — a Space mid-collaboration"
							ratio="16 / 10"
							priority
						/>
					</div>
				</div>
			</section>

			<!-- 2 · Proof -->
			<div class="mx-auto w-full max-w-6xl px-5 sm:px-8">
				<LandingProof />
			</div>

			<!-- 3 · Same room — the differentiator, straight after the proof strip -->
			<LandingSection
				eyebrow="Same room"
				title="Everyone in the Space shares the same context."
				lede="Chats are not private threads. Keep going in someone else's, or fork from any message to take your own line. Messages drift past so you know what everyone is up to."
				divided
			>
				<LandingMedia
					src="multiplayer"
					alt="Several people taking turns in one Cohub chat, with forked sessions and live messages drifting past"
					label="Shared chat — several people in one session"
					ratio="16 / 9"
				/>
			</LandingSection>

			<!-- 4 · Live Works — the strongest outcome: a real URL that feeds back -->
			<LandingSection
				eyebrow="Live Works"
				title="Publish something people can play with."
				lede="A game, a demo, a weird little tool: publish it from a file, a directory, or a running port. Visitors get something live, not a screenshot. And if you let it, a Work can even reach back and change the Space behind it."
				divided
			>
				<LandingMedia
					src="work"
					alt="A published Cohub Work running at its public URL"
					label="Work — published page with its public URL"
					ratio="16 / 10"
				/>
			</LandingSection>

			<!-- 5 · Everywhere — the phone capture beside a real terminal session -->
			<LandingSection
				eyebrow="Everywhere"
				title="The Space follows you."
				lede="Start on the web, keep going on your phone, reach agents from Discord or WeChat, and drive the same Space from your terminal."
				divided
			>
				<div class="surfaces">
					<!-- The capture is a 390x844 viewport; anything else crops the phone. -->
					<LandingMedia
						src="mobile"
						alt="Cohub running on a phone, with the same Space and chat"
						label="Mobile — a Space on a phone"
						ratio="390 / 844"
					/>
					<!-- Rendered as text, not a capture: real output stays sharp at any
					     width and reflows instead of shrinking. -->
					<div class="surface-terminal">
						<LandingTerminal title="cohub — night-sea" lines={cliLines} />
					</div>
				</div>
			</LandingSection>

			<!-- 6 · Any medium — split layout breaks the run of full-width images -->
			<LandingSection
				eyebrow="Any medium"
				title="Text, images, video, music, and running code."
				lede="Generation happens in the conversation, not in a separate tool. Results land in the Space as files you can edit, save, and publish."
				divided
				split
			>
				<LandingMedia
					src="generation"
					alt="A generated poster returned inline in a Cohub chat, with the file saved into the Space"
					label="Inline generation — an image returned in chat"
					ratio="4 / 3"
				/>
			</LandingSection>

			<!-- 7 · Context network — reversed split, so it reads differently again -->
			<LandingSection
				eyebrow="Context network"
				title="No Space is an island."
				lede="Mention @space and another Space joins the conversation as context. Type / and reusable skills are already there. Fork a Save and start with its files loaded — context compounds instead of resetting."
				divided
				split
				reverse
			>
				<LandingMedia
					src="context"
					alt="Mentioning another Space from the composer, with the mention picker open"
					label="@space mention in the composer"
					ratio="4 / 3"
				/>
			</LandingSection>

			<!-- 8 · Sandbox — text-only; density drops on the way into the CTA -->
			<LandingSection
				eyebrow="Cloud sandbox"
				title="Every Space gets a real computer."
				lede="Everything above runs on an isolated environment behind each Space, ready to build, serve, schedule, and keep working while you are away."
				divided
			>
				<LandingSandboxSpec />
			</LandingSection>

			<!-- 9 · Closing CTA -->
			<section class="closing">
				<div class="mx-auto w-full max-w-6xl px-5 sm:px-8">
					<div class="cta-card">
						<h2 class="cta-title">Start a Space. See where it goes.</h2>
						<p class="cta-lede">
							Free to try, open source, and yours to self-host.
						</p>
						<div class="hero-actions justify-center">
							<button type="button" onclick={handlePrimaryCta} class="cta cta-invert group">
								Start a Space
								<ArrowRight class="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
							</button>
						</div>
					</div>
				</div>
			</section>
		</main>

		<footer class="border-t border-border-subtle">
			<div class="mx-auto w-full max-w-6xl px-5 py-14 sm:px-8">
				<div class="flex flex-col gap-10 sm:flex-row sm:items-start sm:justify-between">
					<div class="max-w-xs">
						<a href="/" class="inline-flex items-center gap-2.5" aria-label="Cohub home">
							<div
								class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand text-[14px] font-semibold text-brand-contrast-fg"
							>
								C
							</div>
							<span class="text-[15px] font-semibold tracking-tight text-text-primary">Cohub</span>
						</a>
						<p class="mt-4 text-[13px] leading-6 text-text-tertiary">
							A living space where people and agents create, play, and build together.
						</p>
					</div>

					<div class="grid grid-cols-2 gap-10 sm:grid-cols-3 sm:gap-16">
						<div>
							<div class="footer-heading">Product</div>
							<ul class="footer-list">
								<li><a href="/docs" class="footer-link">Docs</a></li>
								<li><a href="/pricing" class="footer-link">Pricing</a></li>
								<li><a href="/changelog" class="footer-link">Changelog</a></li>
								<li><a href="/trending" class="footer-link">Trending</a></li>
							</ul>
						</div>

						<div>
							<div class="footer-heading">Open source</div>
							<ul class="footer-list">
								<li>
									<a
										href="https://github.com/talesofai/cohub"
										target="_blank"
										rel="noopener noreferrer"
										class="footer-link">GitHub</a
									>
								</li>
								<li>
									<a
										href="https://www.npmjs.com/package/@neta-art/cohub-cli"
										target="_blank"
										rel="noopener noreferrer"
										class="footer-link">CLI on npm</a
									>
								</li>
								<li><a href="/docs/developers/cli" class="footer-link">CLI docs</a></li>
								<li>
									<a
										href="https://github.com/talesofai/cohub/blob/main/docs/self-hosting.md"
										target="_blank"
										rel="noopener noreferrer"
										class="footer-link">Self-hosting</a
									>
								</li>
							</ul>
						</div>

						<div>
							<div class="footer-heading">Connect</div>
							<ul class="footer-list">
								<li>
									<a
										href="https://cohub.run/tzwm/cohub"
										class="footer-link">Built in the open</a
									>
								</li>
								<li>
									<a
										href="https://x.com/NetaArt_AI"
										target="_blank"
										rel="noopener noreferrer"
										class="footer-link">X / Twitter</a
									>
								</li>
								<li><a href="mailto:dev@talesof.ai" class="footer-link">dev@talesof.ai</a></li>
							</ul>
						</div>
					</div>
				</div>

				<div
					class="mt-12 flex flex-col items-start justify-between gap-3 border-t border-border-subtle pt-6 text-[12px] text-text-tertiary sm:flex-row sm:items-center"
				>
					<span>Copyright 2026 Viscept Limited</span>
					<span>Apache License 2.0</span>
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

	.hero {
		padding-top: clamp(3.5rem, 7vw, 6rem);
		padding-bottom: clamp(2.5rem, 5vw, 4rem);
	}

	.hero-title {
		font-size: clamp(2.4rem, 6vw, 4.4rem);
		font-weight: 600;
		line-height: 1.03;
		letter-spacing: 0;
		color: var(--text-primary);
		text-wrap: balance;
	}

	/* Brand emphasis on the verbs — the part that separates Cohub from a chat UI. */
	.accent {
		color: var(--brand);
	}

	.hero-lede {
		margin: 1.5rem auto 0;
		max-width: 34rem;
		font-size: clamp(15px, 1.5vw, 17px);
		line-height: 1.7;
		color: var(--text-tertiary);
		text-wrap: pretty;
	}

	.hero-actions {
		margin-top: 2.25rem;
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		align-items: center;
		gap: 0.75rem;
	}

	.cta {
		display: inline-flex;
		min-height: 44px;
		cursor: pointer;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		border-radius: 6px;
		padding: 0.75rem 1.35rem;
		font-size: 14px;
		font-weight: 500;
		transition:
			background-color 0.2s,
			border-color 0.2s,
			color 0.2s;
	}

	.cta-primary {
		background: var(--brand);
		color: var(--brand-contrast-fg);
	}
	.cta-primary:hover {
		background: var(--brand-hover);
	}

	.cta-secondary {
		border: 1px solid var(--border-subtle);
		color: var(--text-secondary);
	}
	.cta-secondary:hover {
		border-color: var(--border-primary);
		color: var(--text-primary);
	}

	.cta-invert {
		background: var(--brand-contrast-fg);
		color: var(--brand);
	}
	.cta-invert:hover {
		filter: brightness(0.96);
	}

	.cta:focus-visible {
		outline: none;
		box-shadow:
			0 0 0 2px var(--bg-primary),
			0 0 0 4px var(--brand);
	}
	.cta-invert:focus-visible {
		box-shadow:
			0 0 0 2px var(--brand),
			0 0 0 4px var(--brand-contrast-fg);
	}

	.hero-media {
		margin-top: clamp(3rem, 6vw, 4.5rem);
	}

	.surfaces {
		display: grid;
		gap: 1.25rem;
		align-items: start;
	}

	@media (min-width: 720px) {
		/* The phone capture is tall and fixed-width by nature; the terminal is a
		   short block, so centre it against the phone rather than leaving it
		   stranded at the top of a much taller row. */
		.surfaces {
			grid-template-columns: 0.68fr 1.32fr;
			align-items: center;
		}
	}

	.closing {
		padding-block: clamp(4rem, 8vw, 7rem);
	}

	.cta-card {
		position: relative;
		overflow: hidden;
		border-radius: 8px;
		background: var(--brand);
		padding: clamp(3rem, 6vw, 4.5rem) 1.5rem;
		text-align: center;
	}

	.cta-title {
		position: relative;
		font-size: clamp(1.8rem, 3.6vw, 2.7rem);
		font-weight: 600;
		letter-spacing: 0;
		color: var(--brand-contrast-fg);
		text-wrap: balance;
	}

	.cta-lede {
		position: relative;
		margin-top: 1rem;
		font-size: 16px;
		line-height: 1.7;
		color: color-mix(in srgb, var(--brand-contrast-fg) 88%, transparent);
	}

	.footer-heading {
		font-size: 11px;
		font-weight: 500;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		color: var(--text-placeholder);
	}

	.footer-list {
		margin-top: 1rem;
		display: flex;
		flex-direction: column;
		gap: 0.625rem;
		font-size: 13px;
	}

	.footer-link {
		color: var(--text-secondary);
		transition: color 0.2s;
	}
	.footer-link:hover {
		color: var(--text-primary);
	}
</style>
