import { type CohubClientOptions, createCohubClient } from "@neta-art/cohub";
import { PUBLIC_API_ORIGIN, PUBLIC_GATEWAY_ORIGIN } from "$env/static/public";
import {
	clearAuthToken,
	getAuthToken as resolveAccessToken,
	setAuthToken,
} from "$lib/auth";
import { getCurrentRedirectPath, redirectToSignIn } from "$lib/auth-redirect";

const handleUnauthorized = async () => {
	if (typeof window !== "undefined") {
		await redirectToSignIn(getCurrentRedirectPath());
	}
};

const createWebSdk = (options: Partial<CohubClientOptions> = {}) =>
	createCohubClient({
		baseUrl: options.baseUrl ?? PUBLIC_API_ORIGIN ?? "",
		getAccessToken: options.getAccessToken ?? resolveAccessToken,
		onUnauthorized: options.onUnauthorized ?? handleUnauthorized,
		setStoredAuthToken: options.setStoredAuthToken ?? setAuthToken,
		clearStoredAuthToken: options.clearStoredAuthToken ?? clearAuthToken,
		...options,
		websocket: {
			url: PUBLIC_GATEWAY_ORIGIN ?? undefined,
			getAccessToken: resolveAccessToken,
			...options.websocket,
		},
		voice: {
			url: PUBLIC_GATEWAY_ORIGIN ?? undefined,
			getAccessToken: resolveAccessToken,
			...options.voice,
		},
	});

export const sdk = createWebSdk();
export const createWebClient = createWebSdk;
