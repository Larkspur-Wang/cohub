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
let initializedMetaPixelId: string | null = null;
let metaPageViewTracked = false;

function readCookie(name: string) {
	const prefix = `${name}=`;
	return document.cookie
		.split("; ")
		.find((item) => item.startsWith(prefix))
		?.slice(prefix.length);
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

function eventInput(eventKey: "landing" | "ready", eventId: string) {
	const fbclid = new URL(window.location.href).searchParams.get("fbclid");
	return {
		eventKey,
		eventId,
		sourceUrl: window.location.href,
		fbp: readCookie("_fbp"),
		fbc:
			readCookie("_fbc") ??
			(fbclid ? `fb.1.${Date.now()}.${fbclid}` : undefined),
	};
}

export async function startWorkPromotion(workId: string, promotionId: string) {
	const landingEventId = crypto.randomUUID();
	const runtime = await sdk.works.recordPromotionEvent(
		workId,
		promotionId,
		eventInput("landing", landingEventId),
	);
	if (runtime.browser?.provider === "meta")
		initializeMetaPixel(runtime.browser.pixelId);
	return runtime;
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
