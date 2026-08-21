import type { Command } from "commander";
import { json } from "../../output.js";

const frame = { x: 120, y: 80, width: 320, height: 48, rotation: 0 };

const templates: Record<string, unknown> = {
  "create": {
    items: [{
      id: "title",
      type: "text",
      frame,
      props: { text: "Launch plan", fontSize: 32 },
      style: { color: "brand" },
    }],
    connections: [],
    effects: [],
    compositions: [],
  },
  "item:text": {
    id: "title",
    type: "text",
    frame,
    props: { text: "Launch plan", fontSize: 32 },
    style: { color: "brand" },
  },
  "item:image": {
    id: "hero",
    type: "image",
    frame: { x: 120, y: 160, width: 640, height: 360, rotation: 0 },
    source: { kind: "space-file", path: "assets/hero.webp" },
    props: {},
  },
  "item:geo": {
    id: "goal",
    type: "geo",
    frame: { x: 120, y: 160, width: 280, height: 140, rotation: 0 },
    props: { shape: "rounded", text: "Ship" },
    style: { color: "green", fillOpacity: 0.12 },
  },
  "item:frame": {
    id: "scene",
    type: "frame",
    frame: { x: 80, y: 60, width: 960, height: 540, rotation: 0 },
    props: { label: "Scene 1" },
    style: { color: "neutral" },
  },
  "item:draw": {
    id: "stroke",
    type: "draw",
    frame: { x: 100, y: 100, width: 180, height: 100, rotation: 0 },
    props: { points: [{ x: 0, y: 80, p: 0.5 }, { x: 90, y: 10, p: 0.8 }, { x: 180, y: 70, p: 0.5 }] },
    style: { color: "violet", strokeWidth: 4 },
  },
  "item:arrow": {
    id: "arrow",
    type: "arrow",
    frame: { x: 100, y: 100, width: 260, height: 100, rotation: 0 },
    props: { start: { x: 116, y: 150 }, end: { x: 344, y: 150 }, bend: 0, arrowStart: false, arrowEnd: true, label: "next" },
    style: { color: "brand", strokeWidth: 2.5 },
  },
  "item:video": {
    id: "demo-video",
    type: "video",
    frame: { x: 120, y: 160, width: 640, height: 360, rotation: 0 },
    source: { kind: "space-file", path: "assets/demo.mp4" },
    props: {},
  },
  "item:audio": {
    id: "soundtrack",
    type: "audio",
    frame: { x: 120, y: 540, width: 480, height: 96, rotation: 0 },
    source: { kind: "space-file", path: "assets/soundtrack.mp3" },
    props: {},
  },
  "item:file": {
    id: "brief",
    type: "file",
    frame: { x: 120, y: 160, width: 360, height: 220, rotation: 0 },
    source: { kind: "space-file", path: "docs/brief.md" },
    props: {},
  },
  "item:task": {
    id: "task",
    type: "task",
    frame: { x: 120, y: 160, width: 420, height: 240, rotation: 0 },
    props: { taskRunId: "task-run-id", snapshot: { taskType: "generation", status: "running", title: "Generate concept", artifactCount: 0, artifacts: [] } },
  },
  "effect:pulse": {
    id: "pulse-title",
    target: { type: "item", itemId: "title" },
    kind: "effects.pulse",
    kindVersion: 1,
    enabled: true,
    lifecycle: "when-visible",
    timeOrigin: "visible",
    layer: "front",
    seed: "pulse-title",
    params: { amount: 0.04, period: 1600 },
    assetRefs: [],
    metadata: {},
  },
  "effect:float": {
    id: "float-hero",
    target: { type: "item", itemId: "hero" },
    kind: "effects.float",
    kindVersion: 1,
    enabled: true,
    lifecycle: "when-visible",
    timeOrigin: "visible",
    layer: "front",
    seed: "float-hero",
    params: { distance: 8, period: 2200 },
    assetRefs: [],
    metadata: {},
  },
  "composition:fade": {
    id: "intro",
    name: "Intro",
    timeline: {
      duration: 800,
      tracks: [{
        id: "title-opacity",
        target: { type: "item", itemId: "title" },
        channel: "style.opacity",
        channelVersion: 1,
        interpolation: "linear",
        fill: "both",
        keyframes: [
          { time: 0, value: 0 },
          { time: 800, value: 1, easing: "ease-out-cubic" },
        ],
        metadata: {},
      }],
      clips: [],
      markers: [],
    },
    playback: { loop: false, endBehavior: "hold", reducedMotion: { mode: "base" } },
    metadata: {},
  },
  "composition:reveal": {
    id: "reveal",
    name: "Reveal",
    timeline: {
      duration: 900,
      tracks: [{ id: "title-opacity", target: { type: "item", itemId: "title" }, channel: "style.opacity", channelVersion: 1, interpolation: "linear", fill: "both", keyframes: [{ time: 0, value: 0 }, { time: 600, value: 1 }], metadata: {} }],
      clips: [{ id: "reveal-title", kind: "text.reveal", kindVersion: 1, target: { type: "item", itemId: "title" }, start: 0, duration: 600, layer: "content", fill: "both", easing: "ease-out-cubic", params: { mode: "words" }, assetRefs: [], seed: "reveal-title", metadata: {} }],
      markers: [],
    },
    playback: { loop: false, endBehavior: "hold", reducedMotion: { mode: "base" } },
    metadata: {},
  },
  "composition:motion-path": {
    id: "motion",
    name: "Motion path",
    timeline: {
      duration: 1200,
      tracks: [],
      clips: [{ id: "move-hero", kind: "motion.path", kindVersion: 1, target: { type: "item", itemId: "hero" }, start: 0, duration: 1200, layer: "content", fill: "both", easing: "ease-in-out-cubic", params: { points: [{ x: 0, y: 0 }, { x: 160, y: -40 }, { x: 320, y: 0 }], orient: true }, assetRefs: [], seed: "move-hero", metadata: {} }],
      markers: [],
    },
    playback: { loop: false, endBehavior: "hold", reducedMotion: { mode: "base" } },
    metadata: {},
  },
  "composition:particles": {
    id: "celebrate",
    name: "Celebrate",
    timeline: {
      duration: 1000,
      tracks: [],
      clips: [{ id: "particles", kind: "effects.particles", kindVersion: 1, target: { type: "board" }, start: 0, duration: 1000, layer: "front", fill: "none", easing: "linear", params: { count: 420, bounds: { x: 0, y: 0, width: 800, height: 600 } }, assetRefs: [], seed: "particles", metadata: {} }],
      markers: [],
    },
    playback: { loop: false, endBehavior: "reset", reducedMotion: { mode: "base" } },
    metadata: {},
  },
  "composition:camera-focus": {
    id: "tour",
    name: "Tour",
    timeline: {
      duration: 1000,
      tracks: [],
      clips: [{
        id: "focus-title",
        kind: "camera.focus",
        kindVersion: 1,
        target: { type: "camera" },
        start: 0,
        duration: 700,
        layer: "screen",
        fill: "forwards",
        easing: "ease-out-cubic",
        params: { focus: { type: "item", itemId: "title" }, fit: "contain", padding: 32 },
        assetRefs: [],
        seed: "focus-title",
        metadata: {},
      }],
      markers: [],
    },
    playback: { loop: false, endBehavior: "hold", reducedMotion: { mode: "base" } },
    metadata: {},
  },
};

export const BOARD_EXAMPLE_KEYS = Object.keys(templates);

export function boardExample(kind: string, type?: string): unknown {
  const key = type ? `${kind}:${type}` : kind;
  const template = templates[key];
  if (!template) throw new Error(`Unknown Board example: ${key}`);
  return template;
}

export function registerBoardExampleCommands(boards: Command): void {
  boards.command("examples <kind> [type]")
    .description("Print editable semantic JSON templates")
    .addHelpText("after", `
Kinds:
  create
  item text|image|video|audio|file|task|geo|frame|draw|arrow
  effect pulse|float
  composition fade|reveal|motion-path|particles|camera-focus

Examples:
  cohub boards examples item text > item.json
  cohub boards examples composition fade > intro.json`)
    .action((kind: string, type?: string) => {
      json(boardExample(kind, type));
    });
}
