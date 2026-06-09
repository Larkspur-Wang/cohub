import {
	compactSpaceLayout,
	DEFAULT_SPACE_LAYOUT,
	type NormalizedSpaceLayout,
	normalizeSpaceLayout,
	normalizeSpaceLayoutManifest,
	SPACE_LAYOUT_MANIFEST_PATH,
	type SpaceLayoutManifest,
} from "@cohub/protocol";
import { HttpError } from "@neta-art/cohub";
import { sdk } from "$lib/sdk";

export class SpaceLayoutState {
	spaceId = $state<string | null>(null);
	layout = $state<NormalizedSpaceLayout>(DEFAULT_SPACE_LAYOUT);
	manifest = $state<SpaceLayoutManifest | null>(null);
	loading = $state(false);
	saving = $state(false);
	error = $state<string | null>(null);
	saveError = $state<string | null>(null);
	useDefault = $state(false);

	effective: NormalizedSpaceLayout = $derived(this.layout);

	load(spaceId: string, options: { useDefault?: boolean } = {}) {
		this.spaceId = spaceId;
		this.useDefault = Boolean(options.useDefault);
		this.manifest = null;
		this.error = null;
		this.saveError = null;
		this.layout = DEFAULT_SPACE_LAYOUT;
		if (this.useDefault) {
			this.loading = false;
			return;
		}
		this.loading = true;
		void this.loadSpaceLayout(spaceId);
	}

	private async loadSpaceLayout(spaceId: string) {
		try {
			const file = await sdk
				.space(spaceId)
				.files.read(SPACE_LAYOUT_MANIFEST_PATH);
			if (this.spaceId !== spaceId || this.useDefault) return;
			if (!("content" in file)) return;
			const content =
				file.encoding === "base64" ? atob(file.content) : file.content;
			const parsed = JSON.parse(content);
			this.manifest = normalizeSpaceLayoutManifest(parsed);
			this.layout = normalizeSpaceLayout(parsed);
			this.error = null;
		} catch (error) {
			if (this.spaceId !== spaceId || this.useDefault) return;
			if (error instanceof HttpError && error.status === 404) {
				this.manifest = null;
				this.layout = DEFAULT_SPACE_LAYOUT;
				this.error = null;
				return;
			}
			this.error = "Failed to load layout.";
		} finally {
			if (this.spaceId === spaceId) this.loading = false;
		}
	}

	refresh() {
		if (!this.spaceId || this.useDefault) return;
		void this.loadSpaceLayout(this.spaceId);
	}

	async saveManifest(manifest: SpaceLayoutManifest | NormalizedSpaceLayout) {
		if (!this.spaceId || this.saving) return;
		this.saving = true;
		this.saveError = null;
		try {
			const compact = compactSpaceLayout(manifest);
			const spaceId = this.spaceId;
			await sdk.space(spaceId).files.write({
				path: SPACE_LAYOUT_MANIFEST_PATH,
				content: `${JSON.stringify(compact, null, 2)}\n`,
				encoding: "utf-8",
			});
			this.manifest = compact;
			this.layout = normalizeSpaceLayout(compact);
			this.saveError = null;
		} catch (error) {
			this.saveError = "Could not save layout.";
			throw error;
		} finally {
			this.saving = false;
		}
	}
}

export const spaceLayoutState = new SpaceLayoutState();
export { SPACE_LAYOUT_MANIFEST_PATH };
