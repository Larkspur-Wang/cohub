import assert from "node:assert/strict";
import { test } from "node:test";
import {
	inferBoardMediaKind,
	playableBoardMedia,
	resetBoardPlaybackUrlCache,
	type BoardItem,
	worldPoint,
} from "../src/board/index.js";
import {
	boardMediaActionAt,
	mediaPlayBadgeVisible,
} from "../src/board/render/index.js";

function audioItem(): BoardItem {
	return {
		id: "audio",
		type: "audio",
		ref: { kind: "space-file", path: "media/song.mp3" },
		snapshot: { title: "Song", mimeType: "audio/mpeg", mtimeMs: 42 },
		frame: { x: 100, y: 50, width: 320, height: 112, rotation: 0 },
	};
}

test("board media inference prefers reliable MIME information", () => {
	assert.equal(inferBoardMediaKind("clip.jpg", "video/mp4"), "video");
	assert.equal(inferBoardMediaKind("clip.mp4"), "video");
	assert.equal(inferBoardMediaKind("notes.unknown", "text/plain"), "text");
	assert.equal(inferBoardMediaKind("archive.unknown"), "file");
});

test("playback resolution is isolated by source and retries failures", async () => {
	resetBoardPlaybackUrlCache();
	let calls = 0;
	const first = playableBoardMedia(audioItem(), {
		resolveFileUrl: async () => null,
		resolvePlaybackUrl: async () => {
			calls += 1;
			return calls === 1 ? null : "https://one.example/song.mp3";
		},
	});
	const second = playableBoardMedia(audioItem(), {
		resolveFileUrl: async () => "https://two.example/song.mp3",
	});

	assert.equal(await first?.resolveUrl(), null);
	assert.equal(await first?.resolveUrl(), "https://one.example/song.mp3");
	assert.equal(await second?.resolveUrl(), "https://two.example/song.mp3");
});

test("a failed media URL can be invalidated without clearing other entries", async () => {
	resetBoardPlaybackUrlCache();
	let calls = 0;
	const media = playableBoardMedia(audioItem(), {
		resolveFileUrl: async () => {
			calls += 1;
			return `https://cdn.example/song-${calls}.mp3`;
		},
	});

	assert.equal(await media?.resolveUrl(), "https://cdn.example/song-1.mp3");
	assert.equal(await media?.resolveUrl(), "https://cdn.example/song-1.mp3");
	media?.invalidateUrl();
	assert.equal(await media?.resolveUrl(), "https://cdn.example/song-2.mp3");
});

test("board media actions match the visible fixed-size play target", () => {
	const item = audioItem();
	assert.equal(
		mediaPlayBadgeVisible(item, 1, {
			materialized: true,
			hasVideoPreview: false,
		}),
		true,
	);
	assert.deepEqual(
		boardMediaActionAt(item, worldPoint(260, 106), 1, {
			materialized: true,
			hasVideoPreview: false,
		}),
		{ action: "play-media", itemId: "audio" },
	);
	assert.equal(
		boardMediaActionAt(item, worldPoint(300, 106), 1, {
			materialized: true,
			hasVideoPreview: false,
		}),
		null,
	);
});
