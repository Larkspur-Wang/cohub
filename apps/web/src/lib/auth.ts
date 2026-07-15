import LogtoClient, { type IdTokenClaims } from "@logto/browser";

const IS_DEV =
	(typeof location !== "undefined" && location.hostname.startsWith("dev")) ||
	process.env.NODE_ENV === "development";

/**
 * Official hosted defaults. Self-hosted deployments should override via
 * PUBLIC_LOGTO_ENDPOINT / PUBLIC_LOGTO_APP_ID / PUBLIC_LOGTO_API_RESOURCE.
 */
const OFFICIAL = IS_DEV
	? {
			endpoint: "https://dev-auth.neta.art/",
			appId: "vpikk7sl9zwvefiptowtn",
			resource: "https://api.talesofai",
		}
	: {
			endpoint: "https://auth.neta.art/",
			appId: "16ai0wao2mud3xqkbzqo0",
			resource: "https://api.talesofai",
		};

export const API_RESOURCE =
	process.env.PUBLIC_LOGTO_API_RESOURCE?.trim() || OFFICIAL.resource;

const LOGTO_ENDPOINT =
	process.env.PUBLIC_LOGTO_ENDPOINT?.trim() || OFFICIAL.endpoint;

const LOGTO_APP_ID = process.env.PUBLIC_LOGTO_APP_ID?.trim() || OFFICIAL.appId;

/**
 * Lazy browser-only client. Safe to import on the server; construction and
 * method access only happen in the browser.
 */
let logtoClientInstance: LogtoClient | null = null;

function getLogtoClient(): LogtoClient {
	if (typeof window === "undefined") {
		throw new Error("Logto client is only available in the browser");
	}
	if (!logtoClientInstance) {
		logtoClientInstance = new LogtoClient({
			endpoint: LOGTO_ENDPOINT,
			appId: LOGTO_APP_ID,
			scopes: ["openid", "offline_access", "profile", "email"],
			resources: [API_RESOURCE],
		});
	}
	return logtoClientInstance;
}

export const logtoClient: LogtoClient = new Proxy({} as LogtoClient, {
	get(_target, property, _receiver) {
		const client = getLogtoClient();
		const value = Reflect.get(client, property, client);
		return typeof value === "function"
			? (value as (...args: unknown[]) => unknown).bind(client)
			: value;
	},
	set(_target, property, value) {
		const client = getLogtoClient();
		return Reflect.set(client, property, value, client);
	},
});

export const AUTH_TOKEN_STORAGE_KEY = "cohub_token";
/** Lightweight flag for first-paint home redirect (not an auth token). */
export const SESSION_HINT_STORAGE_KEY = "cohub:session-hint";

function hasLogtoSessionResidue(): boolean {
	if (typeof localStorage === "undefined") return false;
	// Logto BrowserStorage keys: logto:<appId>:<item>
	const prefix = `logto:${LOGTO_APP_ID}:`;
	return Boolean(
		localStorage.getItem(`${prefix}refreshToken`) ||
			localStorage.getItem(`${prefix}idToken`),
	);
}

/**
 * Sync, best-effort signal that a browser session may exist.
 * Used to avoid marketing-page flash before auth finishes hydrating.
 * Never treat this as authenticated — always confirm with ensureLoaded().
 */
export function hasLocalSessionHint(): boolean {
	if (typeof window === "undefined" || typeof localStorage === "undefined") {
		return false;
	}
	try {
		if (localStorage.getItem(SESSION_HINT_STORAGE_KEY) === "1") return true;
		const cached = localStorage.getItem(AUTH_TOKEN_STORAGE_KEY)?.trim();
		if (cached) {
			setSessionHint(true);
			return true;
		}
		if (hasLogtoSessionResidue()) {
			setSessionHint(true);
			return true;
		}
		return false;
	} catch {
		return false;
	}
}

export function setSessionHint(active: boolean) {
	if (typeof localStorage === "undefined") return;
	try {
		if (active) localStorage.setItem(SESSION_HINT_STORAGE_KEY, "1");
		else localStorage.removeItem(SESSION_HINT_STORAGE_KEY);
	} catch {
		// ignore quota / private mode
	}
}

type LogtoClientWithRefreshFallback = {
	getAccessTokenByRefreshToken?: (resource?: string) => Promise<string>;
};

const getAccessTokenByRefreshToken = async (): Promise<string | null> => {
	const client = getLogtoClient();
	const refreshToken = await client.getRefreshToken().catch(() => null);
	const refreshWithToken = (client as unknown as LogtoClientWithRefreshFallback)
		.getAccessTokenByRefreshToken;

	if (!refreshToken) return null;

	if (typeof refreshWithToken !== "function") {
		console.warn(
			"[auth] Logto refresh-token fallback is unavailable; upgrade auth integration before relying on missing-ID-token recovery.",
		);
		return null;
	}

	return await refreshWithToken.call(client, API_RESOURCE);
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
	if (typeof window === "undefined") return null;
	try {
		const token = options?.forceRefresh
			? await getAccessTokenByRefreshToken()
			: await getLogtoClient().getAccessToken(API_RESOURCE);
		return sanitizeClientToken(token);
	} catch {
		try {
			return sanitizeClientToken(await getAccessTokenByRefreshToken());
		} catch (error) {
			console.warn("[auth] Failed to resolve access token:", error);
			return null;
		}
	}
};

function sanitizeClientToken(token: string | null | undefined): string | null {
	if (typeof token !== "string") return null;
	const cleaned = token.replace(/[\r\n\t\0]/g, "").trim();
	return cleaned.length > 0 ? cleaned : null;
}

export const getCurrentIdTokenClaims =
	async (): Promise<IdTokenClaims | null> => {
		if (typeof window === "undefined") return null;
		try {
			return await getLogtoClient().getIdTokenClaims();
		} catch {
			return null;
		}
	};

export const hasRecoverableAuthSession = async (): Promise<boolean> => {
	if (typeof window === "undefined") return false;
	const client = getLogtoClient();
	const [hasIdToken, refreshToken] = await Promise.all([
		client.isAuthenticated().catch(() => false),
		client.getRefreshToken().catch(() => null),
	]);

	return hasIdToken || Boolean(refreshToken);
};

export const clearBrokenAuthSession = async () => {
	clearAuthToken();
	if (typeof window === "undefined") return;
	try {
		await getLogtoClient().clearAllTokens();
	} catch {
		// Ignore cleanup failures.
	}
};

export const setAuthToken = (token: string) => {
	if (typeof localStorage === "undefined") return;
	// Keep stored token free of CR/LF so later Authorization headers stay valid
	// (Safari: "The string did not match the expected pattern.").
	const cleaned = token.replace(/[\r\n\t\0]/g, "").trim();
	if (!cleaned) return;
	localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, cleaned);
	setSessionHint(true);
};

export const clearAuthToken = () => {
	if (typeof localStorage === "undefined") return;
	localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
	// Single source of truth for hint teardown — covers clearBrokenAuthSession
	// and redirectToSignIn({ clearSession }) via clearAuthToken().
	setSessionHint(false);
};

const createRedirectState = (redirectPath?: string) => {
	const searchParams = new URLSearchParams();
	if (redirectPath) {
		searchParams.set("redirect_path", redirectPath);
	}
	return searchParams.toString();
};

export const signInWithRedirectPath = async (redirectPath?: string) => {
	const client = getLogtoClient();
	const originalGenerateState = client.adapter.generateState;

	client.adapter.generateState = () => createRedirectState(redirectPath);
	try {
		await client.signIn({
			redirectUri: `${window.location.origin}/callback`,
		});
	} finally {
		client.adapter.generateState = originalGenerateState;
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
