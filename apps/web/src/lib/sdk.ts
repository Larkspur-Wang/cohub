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
		baseUrl: PUBLIC_API_ORIGIN ?? "",
		getAccessToken: resolveAccessToken,
		onUnauthorized: handleUnauthorized,
		setStoredAuthToken: setAuthToken,
		clearStoredAuthToken: clearAuthToken,
		websocket: {
			url: PUBLIC_GATEWAY_ORIGIN ?? undefined,
			getAccessToken: resolveAccessToken,
		},
		...options,
	});

export const sdk = createWebSdk();
export const createWebClient = createWebSdk;
