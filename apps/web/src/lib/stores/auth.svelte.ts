import type { IdTokenClaims } from "@logto/browser";
import { logtoClient } from "$lib/auth";
import { getMe } from "$lib/api";

class AuthStore {
  claims = $state<IdTokenClaims | null>(null);
  isAuthenticated = $state(false);
  loaded = $state(false);
  loading = $state(false);

  // userUuid from backend API (/api/me), used for ownership checks
  // against runtime.userUuid, workspace.userUuid, etc.
  _userUuid = $state<string | null>(null);

  get userUuid(): string | null {
    return this._userUuid;
  }

  async ensureLoaded(force = false) {
    if (this.loaded && !force) return;
    if (this.loading) return;

    this.loading = true;
    try {
      this.isAuthenticated = await logtoClient.isAuthenticated();
      this.claims = this.isAuthenticated
        ? await logtoClient.getIdTokenClaims().catch(() => null)
        : null;

      // Fetch user profile from backend to get the correct uuid
      // that matches runtime.userUuid / workspace.userUuid stored in DB
      if (this.isAuthenticated) {
        try {
          const me = await getMe();
          this._userUuid = (me as { uuid?: string } | null)?.uuid ?? null;
        } catch {
          this._userUuid = null;
        }
      } else {
        this._userUuid = null;
      }

      this.loaded = true;
    } finally {
      this.loading = false;
    }
  }

  reset() {
    this.claims = null;
    this.isAuthenticated = false;
    this.loaded = false;
    this.loading = false;
  }
}

export const authStore = new AuthStore();
