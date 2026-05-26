import LogtoClient, { type IdTokenClaims } from "@logto/browser";

const IS_DEV =
	location.hostname.startsWith("dev") || process.env.NODE_ENV === "development";

export const API_RESOURCE = "https://api.talesofai";

export const logtoClient = new LogtoClient(
	IS_DEV
		? {
				endpoint: "https://dev-auth.neta.art/",
				appId: "vpikk7sl9zwvefiptowtn",
				scopes: ["openid", "offline_access", "profile", "email"],
				resources: [API_RESOURCE],
			}
		: {
				endpoint: "https://auth.neta.art/",
				appId: "16ai0wao2mud3xqkbzqo0",
				scopes: ["openid", "offline_access", "profile", "email"],
				resources: [API_RESOURCE],
			},
);

export const AUTH_TOKEN_STORAGE_KEY = "cohub_token";

type LogtoClientWithRefreshFallback = {
	getAccessTokenByRefreshToken?: (resource?: string) => Promise<string>;
};

const getAccessTokenByRefreshToken = async (): Promise<string | null> => {
	const refreshToken = await logtoClient.getRefreshToken().catch(() => null);
	const refreshWithToken = (
		logtoClient as unknown as LogtoClientWithRefreshFallback
	).getAccessTokenByRefreshToken;

	if (!refreshToken) return null;

	if (typeof refreshWithToken !== "function") {
		console.warn(
			"[auth] Logto refresh-token fallback is unavailable; upgrade auth integration before relying on missing-ID-token recovery.",
		);
		return null;
	}

	return await refreshWithToken.call(logtoClient, API_RESOURCE);
};

type GetAuthTokenOptions = { forceRefresh?: boolean };

/**
 * Resolve a valid API access token.
 *
 * This function is intentionally side-effect-light: it does not redirect or
 * mutate UI state. It lets Logto refresh expired access tokens, and also falls
 * back to the refresh-token path for the rare case where the ID token is gone
 * but the refresh token is still valid.
 */
export const getAuthToken = async (
	options?: GetAuthTokenOptions,
): Promise<string | null> => {
	try {
		if (options?.forceRefresh) {
			return await getAccessTokenByRefreshToken();
		}
		return await logtoClient.getAccessToken(API_RESOURCE);
	} catch {
		try {
			return await getAccessTokenByRefreshToken();
		} catch (error) {
			console.warn("[auth] Failed to resolve access token:", error);
			return null;
		}
	}
};

export const getCurrentIdTokenClaims =
	async (): Promise<IdTokenClaims | null> => {
		try {
			return await logtoClient.getIdTokenClaims();
		} catch {
			return null;
		}
	};

export const hasRecoverableAuthSession = async (): Promise<boolean> => {
	const [hasIdToken, refreshToken] = await Promise.all([
		logtoClient.isAuthenticated().catch(() => false),
		logtoClient.getRefreshToken().catch(() => null),
	]);

	return hasIdToken || Boolean(refreshToken);
};

export const clearBrokenAuthSession = async () => {
	clearAuthToken();
	try {
		await logtoClient.clearAllTokens();
	} catch {
		// Ignore cleanup failures.
	}
};

export const setAuthToken = (token: string) => {
	if (typeof localStorage === "undefined") return;
	localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, token.trim());
};

export const clearAuthToken = () => {
	if (typeof localStorage === "undefined") return;
	localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
};

const createRedirectState = (redirectPath?: string) => {
	const searchParams = new URLSearchParams();
	if (redirectPath) {
		searchParams.set("redirect_path", redirectPath);
	}
	return searchParams.toString();
};

export const signInWithRedirectPath = async (redirectPath?: string) => {
	const originalGenerateState = logtoClient.adapter.generateState;

	logtoClient.adapter.generateState = () => createRedirectState(redirectPath);
	try {
		await logtoClient.signIn({
			redirectUri: `${window.location.origin}/callback`,
		});
	} finally {
		logtoClient.adapter.generateState = originalGenerateState;
	}
};

export const ensureAuth = async (options?: { redirectPath?: string }) => {
	const token = await getAuthToken();
	if (!token) {
		await signInWithRedirectPath(options?.redirectPath);
		return false;
	}
	return true;
};
