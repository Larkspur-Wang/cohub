export type MediaType = "image" | "video";

export interface MediaItem {
	src: string;
	type: MediaType;
	alt?: string;
	poster?: string;
}

const state = $state({
	open: false,
	items: [] as MediaItem[],
	index: 0,
});

export const mediaLightbox = {
	get open() {
		return state.open;
	},
	get items() {
		return state.items;
	},
	get index() {
		return state.index;
	},
	get current(): MediaItem | undefined {
		return state.items[state.index];
	},
	show(item: MediaItem | MediaItem[], startIdx = 0) {
		const items = Array.isArray(item) ? item : [item];
		state.items = items;
		state.index = items.length > 0 ? Math.min(startIdx, items.length - 1) : 0;
		state.open = true;
	},
	close() {
		state.open = false;
		state.items = [];
		state.index = 0;
	},
	next() {
		if (state.items.length > 1) {
			state.index = (state.index + 1) % state.items.length;
		}
	},
	prev() {
		if (state.items.length > 1) {
			state.index = (state.index - 1 + state.items.length) % state.items.length;
		}
	},
};
