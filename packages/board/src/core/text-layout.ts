/**
 * World-space typography shared by the editor, the DOM overlay and the renderer.
 *
 * Measurement goes through Pixi's `DOMAdapter` rather than `document` directly,
 * so the same numbers come out in the browser and in a headless export: the
 * adapter supplies a real 2D context in both, and layout stops depending on
 * which environment happens to be running.
 */

import {
  BOARD_FONT_STACK,
  BOARD_TEXT_FONT_FAMILY,
  BOARD_TEXT_FONT_SIZE,
  BOARD_TEXT_LINE_HEIGHT,
  BOARD_TEXT_MAX_FONT_SIZE,
  BOARD_TEXT_MIN_FONT_SIZE,
} from "@cohub/protocol/board-constants";
import { DOMAdapter } from "pixi.js";

export const TEXT_FONT_FAMILY = BOARD_TEXT_FONT_FAMILY;
export const TEXT_FONT_SIZE = BOARD_TEXT_FONT_SIZE;
export const TEXT_LINE_HEIGHT = BOARD_TEXT_LINE_HEIGHT;
export const TEXT_MIN_FONT_SIZE = BOARD_TEXT_MIN_FONT_SIZE;
export const TEXT_MAX_FONT_SIZE = BOARD_TEXT_MAX_FONT_SIZE;

const TEXT_LINE_HEIGHT_RATIO = TEXT_LINE_HEIGHT / TEXT_FONT_SIZE;
const TEXT_MIN_WIDTH_RATIO = 16 / TEXT_FONT_SIZE;
const TEXT_HORIZONTAL_PADDING_RATIO = 2 / TEXT_FONT_SIZE;

/** Approximate advance width per character, used only when no context exists. */
const FALLBACK_CHARACTER_RATIO = 0.52;

type MeasureContext = { font: string; measureText: (text: string) => { width: number } };

let measureContext: MeasureContext | null | undefined;

function getMeasureContext(): MeasureContext | null {
  if (measureContext !== undefined) return measureContext;
  try {
    const canvas = DOMAdapter.get().createCanvas(1, 1);
    measureContext = (canvas.getContext("2d") as MeasureContext | null) ?? null;
  } catch {
    // No canvas in this environment (bare Node without an adapter): fall back to
    // the ratio estimate rather than failing to lay out at all.
    measureContext = null;
  }
  return measureContext;
}

/** Drop the cached context, so a later adapter swap is picked up. */
export function resetBoardTextMeasurement() {
  measureContext = undefined;
}

export function clampBoardTextFontSize(fontSize: number): number {
  return Math.min(TEXT_MAX_FONT_SIZE, Math.max(TEXT_MIN_FONT_SIZE, fontSize));
}

export function boardTextLineHeight(fontSize: number): number {
  return clampBoardTextFontSize(fontSize) * TEXT_LINE_HEIGHT_RATIO;
}

/** Measure unwrapped plain text into scalable world-space bounds. */
export function measureBoardText(
  text: string,
  fontSize = TEXT_FONT_SIZE,
): { width: number; height: number } {
  const size = clampBoardTextFontSize(fontSize);
  const lines = (text || " ").split("\n");
  const minWidth = size * TEXT_MIN_WIDTH_RATIO;
  const horizontalPadding = size * TEXT_HORIZONTAL_PADDING_RATIO;
  const lineHeight = boardTextLineHeight(size);
  const context = getMeasureContext();
  let width = minWidth;

  if (context) {
    // Must match what the renderers ask Pixi for, or measured widths and drawn
    // widths disagree and text overflows its frame.
    context.font = `500 ${size}px ${BOARD_FONT_STACK}`;
    for (const line of lines) {
      width = Math.max(width, context.measureText(line || " ").width + horizontalPadding);
    }
  } else {
    const characterWidth = size * FALLBACK_CHARACTER_RATIO;
    for (const line of lines) {
      width = Math.max(width, Math.max(1, line.length) * characterWidth + horizontalPadding);
    }
  }

  return {
    width,
    height: Math.max(lineHeight, lines.length * lineHeight),
  };
}
