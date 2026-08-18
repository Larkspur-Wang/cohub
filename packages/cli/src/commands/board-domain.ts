import type { Command } from "commander";
import { registerBoardAnimationCommands } from "./boards/animation.js";
import { registerBoardAppearanceCommands } from "./boards/appearance.js";
import { registerBoardNodeCommands } from "./boards/nodes.js";

export function registerBoardDomainCommands(boards: Command): void {
  registerBoardAppearanceCommands(boards);
  registerBoardNodeCommands(boards);
  registerBoardAnimationCommands(boards);
}
