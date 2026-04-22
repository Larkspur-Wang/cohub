import { type CohubClientOptions, createCohubClient } from "@cohub/sdk";
import { env } from "$env/dynamic/public";
import {
	clearAuthToken,
	logtoClient,
	getAuthToken as resolveAccessToken,
	setAuthToken,
} from "$lib/auth";

const handleUnauthorized = async () => {
	if (typeof window !== "undefined") {
		await logtoClient.signIn(`${window.location.origin}/callback`);
	}
};

const createWebSdk = (options: Partial<CohubClientOptions> = {}) =>
	createCohubClient({
		baseUrl: env.PUBLIC_API_ORIGIN ?? "",
		getAccessToken: resolveAccessToken,
		onUnauthorized: handleUnauthorized,
		setStoredAuthToken: setAuthToken,
		clearStoredAuthToken: clearAuthToken,
		websocket: {
			url: env.PUBLIC_GATEWAY_ORIGIN ?? undefined,
			getAccessToken: resolveAccessToken,
		},
		...options,
	});

export const sdk = createWebSdk();
export const createWebClient = createWebSdk;
