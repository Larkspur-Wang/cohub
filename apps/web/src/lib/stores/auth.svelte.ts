import type { IdTokenClaims } from "@logto/browser";
import { logtoClient } from "$lib/auth";

class AuthStore {
  claims = $state<IdTokenClaims | null>(null);
  isAuthenticated = $state(false);
  loaded = $state(false);
  loading = $state(false);

  get userUuid(): string | null {
    return this.claims?.sub ?? null;
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
