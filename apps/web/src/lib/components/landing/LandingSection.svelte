<script lang="ts">
/**
 * Landing section shell — eyebrow / heading / lede plus an optional media slot.
 *
 * Reveal-on-scroll is pure CSS via a scroll-driven `view()` timeline, gated
 * behind `@supports`. No JS, and crucially no way to strand content: if the
 * feature is unsupported, reduced motion is requested, or the page is being
 * captured or printed, the markup simply stays at its natural visible state.
 *
 * An earlier IntersectionObserver version hid content in CSS and relied on a
 * callback to bring it back, which left whole sections blank whenever the
 * callback did not fire (crawlers, no-JS, full-page capture).
 */
import type { Snippet } from "svelte";

type Props = {
	eyebrow?: string;
	title: string;
	lede?: string;
	/** Centre the header block (used by the closing sections). */
	centered?: boolean;
	/** Visually separate the section with a hairline rule above it. */
	divided?: boolean;
	/**
	 * Put copy and media side by side on wide screens. Alternating this with the
	 * default stacked layout keeps a long run of image sections from reading as
	 * one repeated template.
	 */
	split?: boolean;
	/** In split layout, place the media before the copy. */
	reverse?: boolean;
	children?: Snippet;
};

const {
	eyebrow,
	title,
	lede,
	centered = false,
	divided = false,
	split = false,
	reverse = false,
	children,
}: Props = $props();
</script>

<section class="section {divided ? 'section-divided' : ''}">
	<div class="mx-auto w-full max-w-6xl px-5 sm:px-8">
		<div class={split ? "split" : ""}>
			<div
				class="reveal {centered ? 'mx-auto text-center' : ''} {split
					? 'split-copy'
					: ''} max-w-2xl"
			>
				{#if eyebrow}
					<div class="eyebrow">{eyebrow}</div>
				{/if}
				<h2 class="heading">{title}</h2>
				{#if lede}
					<p class="lede {centered ? 'mx-auto' : ''}">{lede}</p>
				{/if}
			</div>

			{#if children}
				<div
					class="reveal {split
						? `split-media ${reverse ? 'split-media-first' : ''}`
						: 'mt-10 sm:mt-12'}"
				>
					{@render children()}
				</div>
			{/if}
		</div>
	</div>
</section>

<style>
	.section {
		padding-block: clamp(4.5rem, 9vw, 7.5rem);
	}

	.section-divided {
		border-top: 1px solid var(--border-subtle);
	}

	.eyebrow {
		font-size: 12px;
		font-weight: 600;
		letter-spacing: 0.16em;
		text-transform: uppercase;
		color: var(--brand);
	}

	.heading {
		margin-top: 0.75rem;
		font-size: clamp(1.75rem, 3.4vw, 2.6rem);
		font-weight: 600;
		line-height: 1.1;
		letter-spacing: 0;
		color: var(--text-primary);
		text-wrap: balance;
	}

	.lede {
		margin-top: 1rem;
		max-width: 34rem;
		font-size: 16px;
		line-height: 1.7;
		color: var(--text-tertiary);
		text-wrap: pretty;
	}

	.split {
		display: grid;
		gap: 2.5rem;
	}

	@media (min-width: 900px) {
		.split {
			grid-template-columns: 0.85fr 1.15fr;
			align-items: center;
			gap: 4rem;
		}

		/* Media first visually, copy still first in DOM for reading order. */
		.split-media-first {
			grid-column: 1;
			grid-row: 1;
		}

		.split:has(.split-media-first) .split-copy {
			grid-column: 2;
			grid-row: 1;
		}
	}

	/*
	 * Scroll-driven reveal. Content is visible by default; the animation only
	 * adds an entrance where the browser supports it and motion is welcome.
	 */
	@supports (animation-timeline: view()) {
		@media (prefers-reduced-motion: no-preference) {
			.reveal {
				animation: reveal-in linear both;
				animation-timeline: view();
				animation-range: entry 0% entry 44%;
			}
		}
	}

	@keyframes reveal-in {
		from {
			opacity: 0;
			transform: translateY(16px);
		}
		to {
			opacity: 1;
			transform: none;
		}
	}
</style>
