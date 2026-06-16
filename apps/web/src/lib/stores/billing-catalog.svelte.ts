import type { BillingCatalog } from "@neta-art/cohub";
import { sdk } from "$lib/sdk";
import { authStore } from "$lib/stores/auth.svelte";

class BillingCatalogStore {
	catalog = $state<BillingCatalog | null>(null);
	loading = $state(false);
	error = $state<string | null>(null);
	private loadPromise: Promise<BillingCatalog> | null = null;
	private loadedAt = 0;
	private scope: string | null = null;
	private readonly staleMs = 5 * 60 * 1000;

	private currentScope() {
		return authStore.isAuthenticated ? (authStore.userUuid ?? "auth") : "anon";
	}

	async load(
		options: { force?: boolean; silent?: boolean } = {},
	): Promise<BillingCatalog> {
		const scope = this.currentScope();
		const fresh =
			this.catalog &&
			this.scope === scope &&
			Date.now() - this.loadedAt < this.staleMs;
		if (fresh && !options.force) return this.catalog as BillingCatalog;
		if (this.loadPromise && this.scope === scope && !options.force)
			return this.loadPromise;

		this.scope = scope;
		if (!options.silent) this.loading = true;
		this.error = null;
		this.loadPromise = sdk.billing
			.getCatalog()
			.then(({ catalog }) => {
				this.catalog = catalog;
				this.scope = scope;
				this.loadedAt = Date.now();
				return catalog;
			})
			.catch((error) => {
				this.error =
					error instanceof Error
						? error.message
						: "Failed to load billing options";
				throw error;
			})
			.finally(() => {
				this.loading = false;
				this.loadPromise = null;
			});

		return this.loadPromise;
	}

	refresh(): Promise<BillingCatalog> {
		return this.load({ force: true, silent: true });
	}

	clear() {
		this.catalog = null;
		this.error = null;
		this.loadedAt = 0;
		this.scope = null;
	}
}

export const billingCatalogStore = new BillingCatalogStore();
