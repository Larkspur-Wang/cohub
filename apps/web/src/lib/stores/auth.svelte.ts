import type { IdTokenClaims } from "@logto/browser";
import { HttpError, type UserProfile } from "@neta-art/cohub";
import {
	clearBrokenAuthSession,
	getAuthToken,
	getCurrentIdTokenClaims,
	hasRecoverableAuthSession,
} from "$lib/auth";
import { sdk } from "$lib/sdk";

type RestoredAuthSession = {
	isAuthenticated: boolean;
	claims: IdTokenClaims | null;
	userUuid: string | null;
	profile: UserProfile | null;
};

const unauthenticatedSession = (): RestoredAuthSession => ({
	isAuthenticated: false,
	claims: null,
	userUuid: null,
	profile: null,
});

const restoreAuthSession = async (): Promise<RestoredAuthSession> => {
	if (!(await hasRecoverableAuthSession())) {
		return unauthenticatedSession();
	}

	const token = await getAuthToken();
	if (!token) {
		await clearBrokenAuthSession();
		return unauthenticatedSession();
	}

	const claims = await getCurrentIdTokenClaims();
	let userUuid: string | null = null;
	let profile: UserProfile | null = null;

	try {
		const me = await sdk.user.getMe();
		userUuid = me.uuid ?? null;
		profile = me.profile ?? null;
	} catch (error) {
		if (error instanceof HttpError && error.status === 401) {
			await clearBrokenAuthSession();
			return unauthenticatedSession();
		}
		console.warn("[auth] Failed to load current user profile:", error);
	}

	return {
		isAuthenticated: true,
		claims,
		userUuid,
		profile,
	};
};

class AuthStore {
	claims = $state<IdTokenClaims | null>(null);
	isAuthenticated = $state(false);
	loaded = $state(false);
	loading = $state(false);

	// userUuid from backend API (/api/me), used for ownership checks
	// against space.userUuid, session ownership, etc.
	_userUuid = $state<string | null>(null);
	profile = $state<UserProfile | null>(null);

	// Shared promise for in-flight ensureLoaded calls so concurrent callers all wait
	private _loadPromise: Promise<void> | null = null;

	get userUuid(): string | null {
		return this._userUuid;
	}

	async ensureLoaded(force = false) {
		if (this.loaded && !force) return;
		if (this.loading && this._loadPromise) return this._loadPromise;

		this.loading = true;
		this._loadPromise = (async () => {
			try {
				const restored = await restoreAuthSession();
				this.isAuthenticated = restored.isAuthenticated;
				this.claims = restored.claims;
				this._userUuid = restored.userUuid;
				this.profile = restored.profile;
				this.loaded = true;
			} finally {
				this.loading = false;
				this._loadPromise = null;
			}
		})();

		return this._loadPromise;
	}

	async updateProfile(input: {
		displayName?: string;
		avatarUrl?: string | null;
	}) {
		const { profile } = await sdk.user.updateProfile(input);
		this.profile = profile;
		return profile;
	}

	reset() {
		this.claims = null;
		this.isAuthenticated = false;
		this.loaded = false;
		this.loading = false;
		this._userUuid = null;
		this.profile = null;
		this._loadPromise = null;
	}
}

export const authStore = new AuthStore();
