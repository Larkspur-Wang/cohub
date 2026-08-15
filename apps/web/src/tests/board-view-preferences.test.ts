import assert from "node:assert/strict";
import { test } from "node:test";
import {
	boardViewPreferenceFromCamera,
	cameraFromBoardViewPreference,
	readBoardViewPreference,
	writeBoardViewPreference,
} from "$lib/board/board-view-preferences";

function memoryStorage(): Storage {
	const values = new Map<string, string>();
	return {
		get length() {
			return values.size;
		},
		clear: () => values.clear(),
		getItem: (key) => values.get(key) ?? null,
		key: (index) => [...values.keys()][index] ?? null,
		removeItem: (key) => {
			values.delete(key);
		},
		setItem: (key, value) => {
			values.set(key, value);
		},
	};
}

test("Board view preferences preserve the world center across surface sizes", () => {
	const preference = boardViewPreferenceFromCamera(
		{ x: -300, y: -150, zoom: 2 },
		{ width: 1000, height: 700 },
		123,
	);
	assert.deepEqual(preference, {
		centerX: 400,
		centerY: 250,
		zoom: 2,
		updatedAt: 123,
	});
	assert.ok(preference);
	assert.deepEqual(
		cameraFromBoardViewPreference(preference, {
			width: 600,
			height: 400,
		}),
		{ x: -500, y: -300, zoom: 2 },
	);
});

test("Board view preferences are isolated by user, Space, and Board", () => {
	const storage = memoryStorage();
	const preference = { centerX: 10, centerY: 20, zoom: 1.5, updatedAt: 1 };
	writeBoardViewPreference("user-a", "space-a", "board-a", preference, storage);

	assert.deepEqual(
		readBoardViewPreference("user-a", "space-a", "board-a", storage),
		preference,
	);
	assert.equal(
		readBoardViewPreference("user-b", "space-a", "board-a", storage),
		null,
	);
	assert.equal(
		readBoardViewPreference("user-a", "space-b", "board-a", storage),
		null,
	);
	assert.equal(
		readBoardViewPreference("user-a", "space-a", "board-b", storage),
		null,
	);
});

test("Board view preferences tolerate an inaccessible localStorage getter", () => {
	const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
	Object.defineProperty(globalThis, "localStorage", {
		configurable: true,
		get: () => {
			throw new DOMException("Storage access denied", "SecurityError");
		},
	});

	try {
		assert.equal(readBoardViewPreference("user-a", "space-a", "board-a"), null);
		assert.doesNotThrow(() => {
			writeBoardViewPreference("user-a", "space-a", "board-a", {
				centerX: 1,
				centerY: 2,
				zoom: 1,
				updatedAt: 3,
			});
		});
	} finally {
		if (previous) Object.defineProperty(globalThis, "localStorage", previous);
		else delete (globalThis as { localStorage?: Storage }).localStorage;
	}
});

test("Board view preferences ignore corrupt data and clamp zoom", () => {
	const storage = memoryStorage();
	storage.setItem("cohub:board:view-states:user-a:v1", "not-json");
	assert.equal(
		readBoardViewPreference("user-a", "space-a", "board-a", storage),
		null,
	);

	writeBoardViewPreference(
		"user-a",
		"space-a",
		"board-a",
		{ centerX: 1, centerY: 2, zoom: 100, updatedAt: 3 },
		storage,
	);
	assert.equal(
		readBoardViewPreference("user-a", "space-a", "board-a", storage)?.zoom,
		8,
	);
});

test("Board view preferences retain only the 100 most recent Boards", () => {
	const storage = memoryStorage();
	for (let index = 0; index < 101; index += 1) {
		writeBoardViewPreference(
			"user-a",
			"space-a",
			`board-${index}`,
			{ centerX: index, centerY: index, zoom: 1, updatedAt: index },
			storage,
		);
	}

	assert.equal(
		readBoardViewPreference("user-a", "space-a", "board-0", storage),
		null,
	);
	assert.ok(readBoardViewPreference("user-a", "space-a", "board-100", storage));
});
