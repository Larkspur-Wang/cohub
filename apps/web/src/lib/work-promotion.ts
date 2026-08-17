import type { WorkPromotionEventKey } from "@cohub/protocol";
import type { WorkPromotionEventResponse } from "@neta-art/cohub";
import { sdk } from "$lib/sdk";

type MetaFbq = {
	(...args: unknown[]): void;
	callMethod?: (...args: unknown[]) => void;
	queue: unknown[][];
	loaded: boolean;
	version: string;
	push: MetaFbq;
};

declare global {
	interface Window {
		fbq?: MetaFbq;
		_fbq?: MetaFbq;
	}
}

const META_SCRIPT_ID = "cohub-meta-pixel";
const ATTRIBUTION_LATEST_STORAGE_KEY = "cohub:work-promotion:latest";
const ATTRIBUTION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1_000;
const attributionWorkStorageKey = (workId: string) =>
	`cohub:work-promotion:${workId}`;

type WorkPromotionAttribution = {
	promotionId: string;
	workId: string;
	capturedAt: number;
};
let initializedMetaPixelId: string | null = null;
let metaPageViewTracked = false;

function readCookie(name: string) {
	const prefix = `${name}=`;
	return document.cookie
		.split("; ")
		.find((item) => item.startsWith(prefix))
		?.slice(prefix.length);
}

function writeAttribution(attribution: WorkPromotionAttribution) {
	try {
		const value = JSON.stringify(attribution);
		localStorage.setItem(ATTRIBUTION_LATEST_STORAGE_KEY, value);
		localStorage.setItem(attributionWorkStorageKey(attribution.workId), value);
	} catch {
		// Attribution must never block the Work.
	}
}

export function readWorkPromotionAttribution(
	workId?: string,
): WorkPromotionAttribution | null {
	let raw: string | null = null;
	try {
		raw = localStorage.getItem(
			workId
				? attributionWorkStorageKey(workId)
				: ATTRIBUTION_LATEST_STORAGE_KEY,
		);
	} catch {
		return null;
	}
	if (!raw) return null;
	try {
		const parsed = JSON.parse(raw) as Partial<WorkPromotionAttribution>;
		if (
			typeof parsed.promotionId !== "string" ||
			typeof parsed.workId !== "string" ||
			typeof parsed.capturedAt !== "number" ||
			Date.now() - parsed.capturedAt > ATTRIBUTION_MAX_AGE_MS ||
			(workId !== undefined && parsed.workId !== workId)
		)
			return null;
		return parsed as WorkPromotionAttribution;
	} catch {
		return null;
	}
}

function installFbq(): MetaFbq {
	if (window.fbq) return window.fbq;
	const fbq = ((...args: unknown[]) => {
		if (fbq.callMethod) fbq.callMethod(...args);
		else fbq.queue.push(args);
	}) as MetaFbq;
	fbq.push = fbq;
	fbq.loaded = true;
	fbq.version = "2.0";
	fbq.queue = [];
	window.fbq = fbq;
	window._fbq = fbq;
	return fbq;
}

function initializeMetaPixel(pixelId: string) {
	const fbq = installFbq();
	if (initializedMetaPixelId !== pixelId) {
		fbq("init", pixelId);
		initializedMetaPixelId = pixelId;
	}
	if (!document.getElementById(META_SCRIPT_ID)) {
		const script = document.createElement("script");
		script.id = META_SCRIPT_ID;
		script.async = true;
		script.src = "https://connect.facebook.net/en_US/fbevents.js";
		document.head.append(script);
	}
	if (!metaPageViewTracked) {
		fbq("track", "PageView");
		metaPageViewTracked = true;
	}
}

export function getWorkPromotionCheckoutAttribution(workId: string) {
	const attribution = readWorkPromotionAttribution(workId);
	if (!attribution) return null;
	const fbclid = new URL(window.location.href).searchParams.get("fbclid");
	return {
		promotionId: attribution.promotionId,
		sourceUrl: window.location.href,
		fbp: readCookie("_fbp"),
		fbc:
			readCookie("_fbc") ??
			(fbclid ? `fb.1.${Date.now()}.${fbclid}` : undefined),
	};
}

function eventInput(
	eventKey: WorkPromotionEventKey,
	eventId: string,
	extra: { productKey?: string } = {},
) {
	const fbclid = new URL(window.location.href).searchParams.get("fbclid");
	return {
		eventKey,
		eventId,
		sourceUrl: window.location.href,
		fbp: readCookie("_fbp"),
		fbc:
			readCookie("_fbc") ??
			(fbclid ? `fb.1.${Date.now()}.${fbclid}` : undefined),
		...extra,
	};
}

export async function startWorkPromotion(workId: string, promotionId: string) {
	const landingEventId = crypto.randomUUID();
	const runtime = await sdk.works.recordPromotionEvent(
		workId,
		promotionId,
		eventInput("landing", landingEventId),
	);
	writeAttribution({ promotionId, workId, capturedAt: Date.now() });
	if (runtime.browser?.provider === "meta")
		initializeMetaPixel(runtime.browser.pixelId);
	return runtime;
}

export async function reportAttributedWorkPromotionEvent(input: {
	workId: string;
	eventId: string;
	productKey: string;
}) {
	const attribution = readWorkPromotionAttribution(input.workId);
	if (!attribution) return;
	window.fbq?.(
		"track",
		"AddToCart",
		{ content_ids: [input.productKey], content_type: "product" },
		{ eventID: input.eventId },
	);
	await sdk.works.recordPromotionEvent(
		input.workId,
		attribution.promotionId,
		eventInput("paywall_viewed", input.eventId, {
			productKey: input.productKey,
		}),
	);
}

export function reportWorkPromotionCheckoutStarted(input: {
	productKey: string;
	eventId: string;
	value?: number;
	currency?: string;
}) {
	window.fbq?.(
		"track",
		"InitiateCheckout",
		{
			content_ids: [input.productKey],
			content_type: "product",
			...(input.value !== undefined ? { value: input.value } : {}),
			...(input.currency ? { currency: input.currency } : {}),
		},
		{ eventID: input.eventId },
	);
}

export async function reportWorkPromotionRegistration() {
	const attribution = readWorkPromotionAttribution();
	if (!attribution) return;
	const context = getWorkPromotionCheckoutAttribution(attribution.workId);
	const result = await sdk.works.recordPromotionRegistration(
		attribution.workId,
		attribution.promotionId,
		context
			? {
					sourceUrl: context.sourceUrl,
					fbp: context.fbp,
					fbc: context.fbc,
				}
			: undefined,
	);
	if (
		result.reported &&
		result.eventId &&
		result.browser?.provider === "meta"
	) {
		initializeMetaPixel(result.browser.pixelId);
		window.fbq?.(
			"track",
			"CompleteRegistration",
			{},
			{ eventID: result.eventId },
		);
	}
}

export async function reportWorkPromotionReady(
	workId: string,
	promotionId: string,
	runtime: WorkPromotionEventResponse,
) {
	const eventId = crypto.randomUUID();
	if (runtime.browser?.provider === "meta") {
		initializeMetaPixel(runtime.browser.pixelId);
		window.fbq?.(
			"track",
			"ViewContent",
			{ content_ids: [workId], content_type: "product" },
			{ eventID: eventId },
		);
	}
	await sdk.works.recordPromotionEvent(
		workId,
		promotionId,
		eventInput("ready", eventId),
	);
}
