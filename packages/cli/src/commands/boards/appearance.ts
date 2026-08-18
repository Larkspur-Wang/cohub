import {
  BoardAppearanceSchema,
  DEFAULT_BOARD_APPEARANCE,
  boardAppearanceOperation,
  boardPlaybackPolicyOperation,
  boardTitleOperation,
  patchBoardAppearance,
} from "@neta-art/cohub/board";
import type { BoardPlaybackPolicy } from "@neta-art/cohub";
import type { Command } from "commander";
import { handleHttp } from "../../output.js";
import {
  finite,
  type JsonOptions,
  resolvedBoard,
  showUpdated,
  withJson,
} from "./context.js";

function appearanceFrom(metadata: Record<string, unknown>) {
  const parsed = BoardAppearanceSchema.safeParse(metadata.appearance);
  return parsed.success ? parsed.data : DEFAULT_BOARD_APPEARANCE;
}

export function registerBoardAppearanceCommands(boards: Command): void {
  withJson(boards.command("rename <board> <title>").description("Rename a Board"))
    .action(async (target: string, title: string, options: JsonOptions) => {
      try {
        const board = await resolvedBoard(boards, target);
        showUpdated(await board.mutate({ build: () => [boardTitleOperation(title)] }), options);
      } catch (cause) {
        handleHttp(cause);
      }
    });

  withJson(boards.command("background <board>")
    .description("Configure the Board background")
    .option("--color <color>", "Solid CSS color")
    .option("--image <url>", "Public image URL")
    .option("--fit <mode>", "cover, contain, or repeat", "cover")
    .option("--position <position>", "center, top, bottom, left, or right", "center")
    .option("--opacity <value>", "Image opacity from 0 to 1", "1")
    .option("--reset", "Restore the default background")
    .addHelpText("after", `
Examples:
  cohub boards background plan.board --color "#123456"
  cohub boards background plan.board --image https://example.com/bg.webp --fit cover --opacity 0.8`))
    .action(async (target: string, options: JsonOptions & {
      color?: string;
      image?: string;
      fit: string;
      position: string;
      opacity: string;
      reset?: boolean;
    }) => {
      try {
        const selected = [options.color, options.image, options.reset ? "reset" : undefined].filter(Boolean);
        if (selected.length !== 1) throw new Error("Choose one of --color, --image, or --reset");
        if (!["cover", "contain", "repeat"].includes(options.fit)) throw new Error("--fit must be cover, contain, or repeat");
        if (!["center", "top", "bottom", "left", "right"].includes(options.position)) throw new Error("--position must be center, top, bottom, left, or right");
        const opacity = finite(options.opacity, "opacity");
        if (opacity < 0 || opacity > 1) throw new Error("opacity must be between 0 and 1");
        const board = await resolvedBoard(boards, target);
        const result = await board.mutate({
          build(current) {
            const appearance = appearanceFrom(current.board.metadata);
            const background = options.reset
              ? { kind: "solid" as const }
              : options.color
                ? { kind: "solid" as const, color: options.color }
                : {
                    kind: "image" as const,
                    imageUrl: options.image,
                    fit: options.fit as "cover" | "contain" | "repeat",
                    position: options.position as "center" | "top" | "bottom" | "left" | "right",
                    opacity,
                    color: appearance.background.color,
                  };
            return [boardAppearanceOperation(patchBoardAppearance(appearance, { background }))];
          },
        });
        showUpdated(result, options);
      } catch (cause) {
        handleHttp(cause);
      }
    });

  withJson(boards.command("playback-policy <board>")
    .description("Configure automatic Board playback")
    .option("--sequence <id>", "Sequence to play")
    .option("--delay <ms>", "Delay before playback", "0")
    .option("--loop", "Loop the sequence")
    .option("--clear", "Remove the playback policy"))
    .action(async (target: string, options: JsonOptions & {
      sequence?: string;
      delay: string;
      loop?: boolean;
      clear?: boolean;
    }) => {
      try {
        if (options.clear === Boolean(options.sequence)) throw new Error("Use --sequence or --clear");
        const delayMs = finite(options.delay, "delay");
        if (delayMs < 0) throw new Error("delay must be non-negative");
        const policy: BoardPlaybackPolicy | null = options.clear
          ? null
          : { sequenceId: options.sequence as string, delayMs, loop: Boolean(options.loop) };
        const board = await resolvedBoard(boards, target);
        showUpdated(await board.mutate({
          build: (current) => [boardPlaybackPolicyOperation(current.board.metadata, policy)],
        }), options);
      } catch (cause) {
        handleHttp(cause);
      }
    });
}
