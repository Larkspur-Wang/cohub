import { HttpError } from "@neta-art/cohub";
import { clearBrokenAuthSession, signInWithRedirectPath } from "$lib/auth";

export const getCurrentRedirectPath = () => {
	if (typeof window === "undefined") return undefined;
	return `${window.location.pathname}${window.location.search}`;
};

let signInRedirectPromise: Promise<void> | null = null;

export const redirectToSignIn = async (
	redirectPath = getCurrentRedirectPath(),
) => {
	if (signInRedirectPromise) return signInRedirectPromise;

	signInRedirectPromise = (async () => {
		await clearBrokenAuthSession();
		await signInWithRedirectPath(redirectPath);
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
	await redirectToSignIn(redirectPath);
	return true;
};
