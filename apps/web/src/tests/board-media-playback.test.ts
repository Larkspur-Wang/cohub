import assert from "node:assert/strict";
import { test } from "node:test";
import { type BoardItem, worldPoint } from "@neta-art/cohub/board";
import {
	mediaPlayBadgeHit,
	mediaPlayBadgeVisible,
	playableBoardMedia,
	resetBoardPlaybackUrlCache,
} from "../lib/board/board-media-playback.ts";

function audioItem(): BoardItem {
	return {
		id: "audio",
		type: "audio",
		ref: { kind: "space-file", path: "media/song.mp3" },
		snapshot: { title: "Song", mimeType: "audio/mpeg", mtimeMs: 42 },
		frame: { x: 100, y: 50, width: 320, height: 112, rotation: 0 },
	};
}

test("workspace playback uses the streamable resolver and deduplicates it", async () => {
	resetBoardPlaybackUrlCache();
	let previews = 0;
	let playback = 0;
	const source = {
		resolveFileUrl: async () => {
			previews += 1;
			return "data:audio/mpeg;base64,inline";
		},
		resolvePlaybackUrl: async () => {
			playback += 1;
			return "https://cdn.example/song.mp3";
		},
	};
	const first = playableBoardMedia(audioItem(), source);
	const second = playableBoardMedia(audioItem(), source);
	assert.equal(await first?.resolveUrl(), "https://cdn.example/song.mp3");
	assert.equal(await second?.resolveUrl(), "https://cdn.example/song.mp3");
	assert.equal(playback, 1);
	assert.equal(previews, 0);
});

test("identical paths from different asset sources never share playback URLs", async () => {
	resetBoardPlaybackUrlCache();
	const first = playableBoardMedia(audioItem(), {
		resolveFileUrl: async () => "https://one.example/song.mp3",
	});
	const second = playableBoardMedia(audioItem(), {
		resolveFileUrl: async () => "https://two.example/song.mp3",
	});
	assert.equal(await first?.resolveUrl(), "https://one.example/song.mp3");
	assert.equal(await second?.resolveUrl(), "https://two.example/song.mp3");
});

test("failed playback resolution is not pinned in the cache", async () => {
	resetBoardPlaybackUrlCache();
	let calls = 0;
	const media = playableBoardMedia(audioItem(), {
		resolveFileUrl: async () => null,
		resolvePlaybackUrl: async () => {
			calls += 1;
			return calls === 1 ? null : "https://cdn.example/song.mp3";
		},
	});
	assert.equal(await media?.resolveUrl(), null);
	assert.equal(await media?.resolveUrl(), "https://cdn.example/song.mp3");
	assert.equal(calls, 2);
});

test("task play badges only intercept clicks when visibly rendered", () => {
	const task: BoardItem = {
		id: "task",
		type: "task",
		taskRunId: "run",
		snapshot: {
			taskType: "generation",
			status: "completed",
			title: "Clip",
			outputCount: 1,
			primaryOutput: {
				type: "video",
				url: "https://cdn.example/clip.mp4",
			},
		},
		frame: { x: 0, y: 0, width: 320, height: 180, rotation: 0 },
	};
	assert.equal(
		mediaPlayBadgeVisible(task, 1, {
			materialized: false,
			hasVideoPreview: true,
		}),
		false,
	);
	assert.equal(
		mediaPlayBadgeVisible(task, 0.4, {
			materialized: true,
			hasVideoPreview: true,
		}),
		false,
	);
	assert.equal(
		mediaPlayBadgeVisible(task, 1, {
			materialized: true,
			hasVideoPreview: false,
		}),
		false,
	);
	assert.equal(
		mediaPlayBadgeVisible(task, 1, {
			materialized: true,
			hasVideoPreview: true,
		}),
		true,
	);
});

test("play badge keeps a stable screen-space target across zoom levels", () => {
	const item = audioItem();
	assert.equal(mediaPlayBadgeHit(item, worldPoint(260, 106), 1), true);
	assert.equal(mediaPlayBadgeHit(item, worldPoint(285, 106), 1), true);
	assert.equal(mediaPlayBadgeHit(item, worldPoint(285, 106), 2), false);
});
