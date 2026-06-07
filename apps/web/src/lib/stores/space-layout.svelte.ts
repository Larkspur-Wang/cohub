import {
	compactSpaceLayout,
	mergeSpaceLayouts,
	type NormalizedSpaceLayout,
	normalizeSpaceLayoutManifest,
	SPACE_LAYOUT_MANIFEST_PATH,
	type SpaceLayoutManifest,
	type SpaceLayoutPanels,
} from "@cohub/protocol";
import { HttpError } from "@neta-art/cohub";
import { sdk } from "$lib/sdk";

const STORAGE_PREFIX = "cohub:space-layout:";

function storageKey(spaceId: string) {
	return `${STORAGE_PREFIX}${spaceId}:override`;
}

function readLocalOverride(spaceId: string): SpaceLayoutManifest | null {
	if (typeof window === "undefined") return null;
	try {
		const raw = window.localStorage.getItem(storageKey(spaceId));
		if (!raw) return null;
		return normalizeSpaceLayoutManifest(JSON.parse(raw));
	} catch {
		return null;
	}
}

function writeLocalOverride(
	spaceId: string,
	value: SpaceLayoutManifest | null,
) {
	if (typeof window === "undefined") return;
	try {
		if (!value || !value.panels || Object.keys(value.panels).length === 0) {
			window.localStorage.removeItem(storageKey(spaceId));
			return;
		}
		window.localStorage.setItem(storageKey(spaceId), JSON.stringify(value));
	} catch {
		// Layout preferences must never block workspace interactions.
	}
}

function patchManifest(
	manifest: SpaceLayoutManifest | null,
	panelId: keyof SpaceLayoutPanels,
	patch: NonNullable<SpaceLayoutPanels[keyof SpaceLayoutPanels]>,
): SpaceLayoutManifest {
	return (
		normalizeSpaceLayoutManifest({
			version: 1,
			panels: {
				...(manifest?.panels ?? {}),
				[panelId]: {
					...(manifest?.panels?.[panelId] ?? {}),
					...patch,
				},
			},
		}) ?? { version: 1 }
	);
}

export class SpaceLayoutState {
	spaceId = $state<string | null>(null);
	spaceLayout = $state<SpaceLayoutManifest | null>(null);
	localOverride = $state<SpaceLayoutManifest | null>(null);
	loading = $state(false);
	saving = $state(false);
	error = $state<string | null>(null);
	saveError = $state<string | null>(null);

	effective: NormalizedSpaceLayout = $derived(
		mergeSpaceLayouts(this.spaceLayout, this.localOverride),
	);

	load(spaceId: string) {
		this.spaceId = spaceId;
		this.spaceLayout = null;
		this.localOverride = readLocalOverride(spaceId);
		this.error = null;
		this.saveError = null;
		this.loading = true;
		void this.loadSpaceLayout(spaceId);
	}

	private async loadSpaceLayout(spaceId: string) {
		try {
			const file = await sdk
				.space(spaceId)
				.files.read(SPACE_LAYOUT_MANIFEST_PATH);
			if (this.spaceId !== spaceId) return;
			if (!("content" in file)) return;
			const content =
				file.encoding === "base64" ? atob(file.content) : file.content;
			this.spaceLayout = normalizeSpaceLayoutManifest(JSON.parse(content));
			this.error = null;
		} catch (error) {
			if (this.spaceId !== spaceId) return;
			if (error instanceof HttpError && error.status === 404) {
				this.spaceLayout = null;
				this.error = null;
				return;
			}
			this.error =
				error instanceof Error ? error.message : "Failed to load layout";
		} finally {
			if (this.spaceId === spaceId) this.loading = false;
		}
	}

	refresh() {
		if (!this.spaceId) return;
		void this.loadSpaceLayout(this.spaceId);
	}

	updateLocalPanel(
		panelId: keyof SpaceLayoutPanels,
		patch: NonNullable<SpaceLayoutPanels[keyof SpaceLayoutPanels]>,
	) {
		if (!this.spaceId) return;
		this.localOverride = patchManifest(this.localOverride, panelId, patch);
		writeLocalOverride(this.spaceId, this.localOverride);
	}

	resetLocal() {
		if (!this.spaceId) return;
		this.localOverride = null;
		writeLocalOverride(this.spaceId, null);
	}

	async saveToSpace() {
		if (!this.spaceId || this.saving) return;
		this.saving = true;
		this.saveError = null;
		try {
			const manifest = compactSpaceLayout(this.effective);
			const spaceId = this.spaceId;
			await sdk.space(spaceId).files.write({
				path: SPACE_LAYOUT_MANIFEST_PATH,
				content: `${JSON.stringify(manifest, null, 2)}\n`,
				encoding: "utf-8",
			});
			this.spaceLayout = manifest;
			this.localOverride = null;
			writeLocalOverride(spaceId, null);
			this.saveError = null;
		} catch (error) {
			this.saveError =
				error instanceof Error ? error.message : "Could not save layout";
		} finally {
			this.saving = false;
		}
	}
}

export const spaceLayoutState = new SpaceLayoutState();
export { SPACE_LAYOUT_MANIFEST_PATH };
