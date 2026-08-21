import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/**
 * A guard on the undo/redo write-back.
 *
 * `applyBoardSemanticCommands` returns a whole document, but the editor has two writers: one
 * for items alone and one for items plus relations. Undo and redo shipped using
 * the items-only writer, so replaying a step computed the restored relations and
 * then threw them away — deleting a connected node could not be undone.
 *
 * The editor is built on runes and cannot be instantiated under `node --test`,
 * so this asserts the shape of the source instead. It is a blunt check, but it
 * pins the one line that was wrong, which the document-level tests cannot: they
 * pass whether or not the result is ever written back.
 */

const source = readFileSync(
	new URL("../lib/board/editor.svelte.ts", import.meta.url),
	"utf8",
);

/** Body of a top-level `function name() { ... }` in the editor source. */
function functionBody(name: string): string {
	const start = source.indexOf(`\tfunction ${name}(`);
	assert.notEqual(start, -1, `${name} not found in editor source`);
	const open = source.indexOf("{", start);
	let depth = 0;
	for (let index = open; index < source.length; index += 1) {
		const char = source[index];
		if (char === "{") depth += 1;
		else if (char === "}") {
			depth -= 1;
			if (depth === 0) return source.slice(open, index + 1);
		}
	}
	throw new Error(`unbalanced braces while reading ${name}`);
}

for (const name of ["undo", "redo"]) {
	test(`${name} writes back relations, not only items`, () => {
		const body = functionBody(name);
		assert.ok(
			body.includes("applyBoardSemanticCommands"),
			`${name} should replay commands through applyBoardSemanticCommands`,
		);
		assert.ok(
			body.includes("setContent("),
			`${name} must write items and connections together via setContent`,
		);
		assert.ok(
			!/\bsetItems\(/.test(body),
			`${name} must not use setItems: it drops the connections half of the step`,
		);
	});
}

test("setContent writes both halves of the document", () => {
	const body = functionBody("setContent");
	assert.ok(body.includes("items:"), "setContent should write items");
	assert.ok(
		body.includes("connections:"),
		"setContent should write connections",
	);
});

test("setItems deliberately leaves connections alone", () => {
	// Not a defect: relation-free edits (a drag, a resize) should not have to
	// restate the relation set. The bug was choosing this writer for undo.
	const body = functionBody("setItems");
	assert.ok(
		!body.includes("connections:"),
		"setItems is the items-only writer by design",
	);
});
