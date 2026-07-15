import { HttpError } from "@neta-art/cohub";
import {
	clearAuthJustCompleted,
	clearAuthToken,
	clearBrokenAuthSession,
	hasRecentAuthCompletion,
	sanitizeRedirectPath,
	signInWithRedirectPath,
} from "$lib/auth";

export const getCurrentRedirectPath = () => {
	if (typeof window === "undefined") return undefined;
	return sanitizeRedirectPath(
		`${window.location.pathname}${window.location.search}`,
	);
};

let signInRedirectPromise: Promise<void> | null = null;

/**
 * Start OAuth sign-in. Guards against silent SSO loops after a just-completed
 * callback: if auth finished recently and we still got a 401, clear local
 * session and land on home instead of bouncing through Logto again.
 */
export const redirectToSignIn = async (
	redirectPath = getCurrentRedirectPath(),
	options?: { clearSession?: boolean },
) => {
	if (signInRedirectPromise) return signInRedirectPromise;

	signInRedirectPromise = (async () => {
		const safePath = sanitizeRedirectPath(redirectPath);

		// After callback, another 401 is almost always a broken/misconfigured
		// session — re-entering SSO would infinite-loop with silent login.
		// Always hard-navigate home so in-memory stores drop with the page,
		// even when already on "/" (common post-callback destination).
		if (hasRecentAuthCompletion()) {
			clearAuthJustCompleted();
			await clearBrokenAuthSession();
			if (typeof window !== "undefined") {
				window.location.replace("/");
			}
			return;
		}

		if (options?.clearSession) {
			await clearBrokenAuthSession();
		} else {
			clearAuthToken();
		}
		await signInWithRedirectPath(safePath);
	})().finally(() => {
		signInRedirectPromise = null;
	});

	return signInRedirectPromise;
};

export const handleUnauthorizedError = async (
	error: unknown,
	redirectPath?: string,
): Promise<boolean> => {
	if (!(error instanceof HttpError) || error.status !== 401) return false;
	await redirectToSignIn(redirectPath, { clearSession: true });
	return true;
};
