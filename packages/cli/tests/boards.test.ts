import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BoardAuthoringItemSchema,
  BoardCompositionInputSchema,
  BoardCreateInputSchema,
  BoardEffectSchema,
} from "@cohub/protocol";
import { Command } from "commander";
import {
  BOARD_EXAMPLE_KEYS,
  boardExample,
} from "../src/commands/boards/examples.js";
import {
  parseJsonObject,
  parseViewport,
  registerBoards,
} from "../src/commands/boards.js";

function createProgram(): { program: Command; boards: Command } {
  const program = new Command("cohub")
    .option("-s, --space <id>", "Target space ID")
    .helpOption("-h, --help", "Show help");
  return { program, boards: registerBoards(program) };
}

test("Board commands and every subcommand expose -h", () => {
  const { boards } = createProgram();
  const names = boards.commands.map((command) => command.name());
  assert.deepEqual(names, [
    "create",
    "inspect",
    "capabilities",
    "examples",
    "rename",
    "background",
    "playback-policy",
    "connect",
    "disconnect",
    "items",
    "effects",
    "compositions",
    "export",
    "play",
    "pause",
    "seek",
    "stop",
    "watch",
  ]);
  assert.match(boards.helpInformation(), /-h, --help/);
  for (const command of boards.commands) {
    assert.match(command.helpInformation(), /-h, --help/, `${command.name()} is missing -h`);
    for (const child of command.commands) {
      assert.match(child.helpInformation(), /-h, --help/, `${command.name()} ${child.name()} is missing -h`);
    }
  }
  const play = boards.commands.find((command) => command.name() === "play");
  assert.ok(play);
  assert.doesNotMatch(play.helpInformation(), /--loop/);
});

test("every Board example is valid semantic input", () => {
  const effectInput = BoardEffectSchema.omit({ boardId: true, revision: true });
  for (const key of BOARD_EXAMPLE_KEYS) {
    const [kind, type] = key.split(":");
    const value = boardExample(kind as string, type);
    const schema = kind === "create"
      ? BoardCreateInputSchema.omit({ path: true, mutationId: true })
      : kind === "item"
        ? BoardAuthoringItemSchema
        : kind === "effect"
          ? effectInput
          : BoardCompositionInputSchema;
    assert.equal(schema.safeParse(value).success, true, key);
  }
});

test("Board JSON and inspect inputs are parsed without rewriting payload data", () => {
  const value = parseJsonObject('{"nodes":[{"type":"custom.node","data":{"raw":true}}]}');
  assert.deepEqual(value, {
    nodes: [{ type: "custom.node", data: { raw: true } }],
  });
  assert.deepEqual(parseViewport("-10,20,1280,720"), {
    x: -10,
    y: 20,
    width: 1280,
    height: 720,
  });
  assert.throws(() => parseJsonObject("[]"), /JSON object/);
  assert.throws(() => parseViewport("0,0,0,100"), /greater than zero/);
  assert.throws(() => parseViewport("0,0,,100"), /finite number/);
});
