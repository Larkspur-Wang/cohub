import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import type { Command } from "commander";
import { resolveToken } from "../auth.js";
import { createClient } from "../client.js";
import { table, json as outJson, error, handleHttp, type Row } from "../output.js";

type GenerationContentBlock =
  | { type: "text"; text: string; _meta?: Record<string, unknown> }
  | { type: "image"; source: GenerationSource; _meta?: Record<string, unknown> }
  | { type: "video"; source: GenerationSource; _meta?: Record<string, unknown> }
  | { type: "audio"; source: GenerationSource; _meta?: Record<string, unknown> };

type GenerationSource =
  | { type: "url"; url: string }
  | { type: "base64"; media_type: string; data: string }
  | { type: "space_file"; space_id: string; path: string };

const mimeByExt: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
};

function parseValue(value: string): unknown {
  const trimmed = value.trim();
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
    try {
      return JSON.parse(trimmed) as unknown;
    } catch {
      return value;
    }
  }
  return value;
}

function parseParams(param?: string[], parameters?: string): Record<string, unknown> | undefined {
  const result = parameters ? JSON.parse(parameters) as Record<string, unknown> : {};
  for (const item of param ?? []) {
    const index = item.indexOf("=");
    if (index <= 0) throw new Error(`Invalid --param value: ${item}`);
    result[item.slice(0, index)] = parseValue(item.slice(index + 1));
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

async function contentFromPathOrUrl(type: "image" | "video" | "audio", value: string): Promise<GenerationContentBlock> {
  if (/^https?:\/\//.test(value)) return { type, source: { type: "url", url: value } } as GenerationContentBlock;
  const data = await readFile(value);
  const media_type = mimeByExt[extname(value).toLowerCase()] ?? "application/octet-stream";
  return { type, source: { type: "base64", media_type, data: data.toString("base64") } } as GenerationContentBlock;
}

async function saveOutputs(output: GenerationContentBlock[], outputPath: string): Promise<void> {
  const files = output.filter((block) => block.type !== "text") as Array<Extract<GenerationContentBlock, { type: "image" | "video" | "audio" }>>;
  if (files.length === 0) return;
  const info = await stat(outputPath).catch(() => null);
  const isDir = info?.isDirectory() ?? (!extname(outputPath) && files.length > 1);
  if (files.length > 1 && !isDir) throw new Error("--output must be a directory when generation returns multiple files");
  if (isDir) await mkdir(outputPath, { recursive: true });

  for (const [i, block] of files.entries()) {
    const source = block.source;
    const target = isDir ? join(outputPath, outputName(block.type, source.type === "url" ? source.url : undefined, i)) : outputPath;
    if (source.type === "url") {
      const response = await fetch(source.url);
      if (!response.ok) throw new Error(`Failed to download ${source.url}: HTTP ${response.status}`);
      await writeFile(target, Buffer.from(await response.arrayBuffer()));
    } else if (source.type === "base64") {
      await writeFile(target, Buffer.from(source.data, "base64"));
    }
  }
}

function outputName(type: string, url: string | undefined, index: number): string {
  const fromUrl = url ? basename(new URL(url).pathname) : "";
  if (fromUrl && fromUrl.includes(".")) return `generation-${index + 1}-${fromUrl}`;
  const ext = type === "video" ? "mp4" : type === "audio" ? "bin" : "png";
  return `generation-${index + 1}.${ext}`;
}

function printGeneration(output: GenerationContentBlock[]): void {
  for (const block of output) {
    if (block.type === "text") console.log(block.text);
    else if (block.source.type === "url") console.log(`${block.type}: ${block.source.url}`);
    else if (block.source.type === "base64") console.log(`${block.type}: base64 ${block.source.media_type} (${block.source.data.length} chars)`);
    else console.log(`${block.type}: ${block.source.space_id}:${block.source.path}`);
  }
}

export function registerGenerations(program: Command): void {
  program
    .command("generate")
    .description("Generate multimodal content")
    .argument("<prompt>", "Prompt text")
    .requiredOption("--model <model>", "Generation model")
    .option("--image <path-or-url>", "Image input", collect, [])
    .option("--video <path-or-url>", "Video input", collect, [])
    .option("--audio <path-or-url>", "Audio input", collect, [])
    .option("--param <key=value>", "Generation parameter", collect, [])
    .option("--parameters <json>", "Generation parameters JSON")
    .option("--metadata <json>", "Metadata JSON")
    .option("--output <path>", "Save generated file output")
    .option("--json", "Output as JSON")
    .action(async (prompt: string, opts: {
      model: string;
      image: string[];
      video: string[];
      audio: string[];
      param: string[];
      parameters?: string;
      metadata?: string;
      output?: string;
      json?: boolean;
    }) => {
      const token = resolveToken();
      if (!token) return error("Not authenticated", "Run 'cohub auth login <token>'");
      try {
        const content: GenerationContentBlock[] = [{ type: "text", text: prompt }];
        content.push(...await Promise.all(opts.image.map((value) => contentFromPathOrUrl("image", value))));
        content.push(...await Promise.all(opts.video.map((value) => contentFromPathOrUrl("video", value))));
        content.push(...await Promise.all(opts.audio.map((value) => contentFromPathOrUrl("audio", value))));
        const generation = await createClient(token).generations.create({
          model: opts.model,
          content,
          parameters: parseParams(opts.param, opts.parameters),
          metadata: opts.metadata ? JSON.parse(opts.metadata) as Record<string, unknown> : undefined,
        });
        if (opts.output && generation.output) await saveOutputs(generation.output, opts.output);
        if (opts.json) return outJson(generation);
        printGeneration(generation.output ?? []);
      } catch (e: unknown) {
        handleHttp(e);
      }
    });

  const cmd = program.command("generations").description("Generation model declarations");
  cmd
    .command("ls")
    .alias("list")
    .description("List generation declarations")
    .option("--json", "Output as JSON")
    .action(async (opts: { json?: boolean }) => {
      const token = resolveToken();
      if (!token) return error("Not authenticated", "Run 'cohub auth login <token>'");
      try {
        const response = await createClient(token).generations.listDeclarations();
        if (opts.json) return outJson(response);
        table(response.declarations as unknown as Row[], [
          { key: "model", label: "Model" },
          { key: "title", label: "Title" },
          { key: "description", label: "Description" },
        ]);
      } catch (e: unknown) {
        handleHttp(e);
      }
    });
}

function collect(value: string, previous: string[]): string[] {
  previous.push(value);
  return previous;
}
