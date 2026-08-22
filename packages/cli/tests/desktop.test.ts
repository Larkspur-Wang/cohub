import assert from "node:assert/strict";
import { test } from "node:test";
import { Command } from "commander";
import { registerDesktop, registerLegacyUi } from "../src/commands/desktop.js";

function createProgram(): { desktop: Command; open: Command } {
  const program = new Command("cohub")
    .option("-s, --space <id>", "Target space ID")
    .helpOption("-h, --help", "Show help");
  registerDesktop(program);
  const desktop = program.commands.find((command) => command.name() === "desktop");
  assert.ok(desktop, "desktop command must be registered");
  const open = desktop.commands.find((command) => command.name() === "open");
  assert.ok(open, "desktop open must be registered");
  return { desktop, open };
}

/** `helpInformation()` omits addHelpText sections. */
function renderHelp(command: Command): string {
  let text = "";
  command.configureOutput({ writeOut: (chunk) => { text += chunk; } });
  command.outputHelp();
  return text;
}

test("opening and calling an app is one command", () => {
  const { desktop, open } = createProgram();
  assert.deepEqual(desktop.commands.map((command) => command.name()), ["open"]);
  assert.deepEqual(open.registeredArguments.map((arg) => arg.name()), ["app-or-file"]);
});

test("desktop open exposes call, targeting, and retry options", () => {
  const { open } = createProgram();
  const options = open.options.map((option) => option.long);
  for (const expected of [
    "--call",
    "--data",
    "--input",
    "--client",
    "--command-id",
    "--no-wait",
    "--timeout-ms",
    "--json",
  ]) {
    assert.ok(options.includes(expected), `missing option ${expected}`);
  }
});

test("desktop open help explains provenance-scoped targeting", () => {
  const help = renderHelp(createProgram().open);
  assert.match(help, /only the desktop that originated the current chat/);
  assert.match(help, /cohub desktop open app:\/\/alice\/studio\/launch/);
  assert.match(help, /--call board\.focus/);
});

test("the legacy ui preview alias stays registered", () => {
  const program = new Command("cohub");
  registerLegacyUi(program);
  const ui = program.commands.find((command) => command.name() === "ui");
  assert.ok(ui, "ui command must be registered");
  const preview = ui.commands.find((command) => command.name() === "preview");
  assert.ok(preview, "ui preview must be registered");
  assert.match(preview.description(), /Deprecated/);
});
