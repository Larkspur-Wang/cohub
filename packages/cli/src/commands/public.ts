import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readdir } from "node:fs/promises";
import { basename, extname, relative, resolve } from "node:path";
import type {
  CohubHttpClient,
  PublicFileDeleteResponse,
  PublicFileListEntry,
  PublicFileUploadPlanEntry,
} from "@neta-art/cohub";
import type { Command } from "commander";
import { createClient } from "../client.js";
import { error, handleHttp, json as outJson, jsonRequested } from "../output.js";
import { resolveSpace } from "../space.js";

const UPLOAD_CONCURRENCY = 4;

const MIME_TYPES: Record<string, string> = {
  ".aac": "audio/aac",
  ".avi": "video/x-msvideo",
  ".avif": "image/avif",
  ".css": "text/css; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".gif": "image/gif",
  ".htm": "text/html; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".m4a": "audio/mp4",
  ".md": "text/markdown; charset=utf-8",
  ".mov": "video/quicktime",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
  ".ogg": "audio/ogg",
  ".ogv": "video/ogg",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".wasm": "application/wasm",
  ".wav": "audio/wav",
  ".webm": "video/webm",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".xml": "application/xml; charset=utf-8",
  ".zip": "application/zip",
};

type LocalPublicFile = {
  id: string;
  localPath: string;
  publicPath: string;
  size: number;
  mimeType: string;
};

type PublicCommandDeps = {
  createClient?: () => CohubHttpClient;
  fetch?: typeof fetch;
};

function hasControlCharacters(value: string) {
  return [...value].some((char) => {
    const code = char.charCodeAt(0);
    return code <= 0x1f || (code >= 0x7f && code <= 0x9f);
  });
}

function terminalText(value: string) {
  return [...value].map((char) => {
    const code = char.charCodeAt(0);
    return code <= 0x1f || (code >= 0x7f && code <= 0x9f)
      ? `\\u${code.toString(16).padStart(4, "0")}`
      : char;
  }).join("");
}

function normalizePublicPath(input: string) {
  const value = input.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
  if (!value || value.startsWith("/") || hasControlCharacters(value)) {
    return error("Invalid public path");
  }
  const parts = value.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) {
    return error("Invalid public path");
  }
  return parts.join("/");
}

function mimeTypeForPath(path: string) {
  return MIME_TYPES[extname(path).toLowerCase()] ?? "application/octet-stream";
}

async function walkDirectory(root: string, directory: string, destination: string): Promise<LocalPublicFile[]> {
  const names = await readdir(directory);
  names.sort((left, right) => left.localeCompare(right));
  const files: LocalPublicFile[] = [];
  for (const name of names) {
    const localPath = resolve(directory, name);
    const info = await lstat(localPath);
    if (info.isSymbolicLink()) return error("Symlinks are not supported", relative(root, localPath));
    if (info.isDirectory()) {
      files.push(...await walkDirectory(root, localPath, destination));
      continue;
    }
    if (!info.isFile()) continue;
    const nestedPath = relative(root, localPath).replace(/\\/g, "/");
    const publicPath = normalizePublicPath(`${destination}/${nestedPath}`);
    files.push({
      id: randomUUID(),
      localPath,
      publicPath,
      size: info.size,
      mimeType: mimeTypeForPath(localPath),
    });
  }
  return files;
}

export async function collectPublicUpload(source: string, destination?: string): Promise<{
  files: LocalPublicFile[];
  destination: string;
  entryPath: string | null;
}> {
  const localPath = resolve(source);
  const info = await lstat(localPath).catch(() => null);
  if (!info) return error("Source not found", source);
  if (info.isSymbolicLink()) return error("Symlinks are not supported", source);

  if (info.isFile()) {
    const publicPath = normalizePublicPath(
      destination
        ? destination.endsWith("/") ? `${destination}${basename(localPath)}` : destination
        : basename(localPath),
    );
    return {
      destination: publicPath,
      entryPath: publicPath,
      files: [{
        id: randomUUID(),
        localPath,
        publicPath,
        size: info.size,
        mimeType: mimeTypeForPath(localPath),
      }],
    };
  }
  if (!info.isDirectory()) return error("Source must be a file or directory", source);

  const target = normalizePublicPath(destination ?? basename(localPath));
  const files = await walkDirectory(localPath, localPath, target);
  if (files.length === 0) return error("Directory contains no files", source);
  const indexPath = `${target}/index.html`;
  return {
    files,
    destination: `${target}/`,
    entryPath: files.some((file) => file.publicPath === indexPath) ? indexPath : null,
  };
}

async function mapSettledWithConcurrency<T>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<void>,
) {
  const errors: Error[] = [];
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      try {
        await mapper(items[index] as T);
      } catch (cause) {
        errors.push(cause instanceof Error ? cause : new Error(String(cause)));
      }
    }
  });
  await Promise.all(workers);
  return errors;
}

async function putPublicFile(
  file: LocalPublicFile,
  plan: PublicFileUploadPlanEntry,
  fetchImpl: typeof fetch,
) {
  const response = await fetchImpl(plan.uploadUrl, {
    method: "PUT",
    headers: plan.headers,
    body: createReadStream(file.localPath) as never,
    duplex: "half",
  } as RequestInit & { duplex: "half" });
  if (response.ok) return;
  const detail = await response.text().catch(() => "");
  if (response.status === 409 || response.status === 412) {
    throw new Error(`${file.publicPath} already exists. Use --overwrite.`);
  }
  throw new Error(`Failed to upload ${file.publicPath}: HTTP ${response.status}${detail ? ` — ${detail}` : ""}`);
}

function uploadFailure(errors: Error[]) {
  if (errors.length === 1) return errors[0] as Error;
  const first = errors[0]?.message ?? "Upload failed";
  return new Error(`${first} (${errors.length} files failed)`);
}

async function uploadPublic(
  command: Command,
  source: string,
  destination: string | undefined,
  opts: { overwrite?: boolean; json?: boolean },
  deps: PublicCommandDeps,
) {
  const client = deps.createClient?.() ?? createClient();
  const spaceId = resolveSpace(command);
  try {
    const upload = await collectPublicUpload(source, destination);
    const plan = await client.space(spaceId).publicFiles.createUpload({
      overwrite: Boolean(opts.overwrite),
      entries: upload.files.map((file) => ({
        id: file.id,
        relativePath: file.publicPath,
        size: file.size,
        mimeType: file.mimeType,
      })),
    });

    if (opts.overwrite && !jsonRequested(opts)) {
      process.stderr.write(`Overwrite enabled for ${upload.destination}\n`);
    }

    const filesById = new Map(upload.files.map((file) => [file.id, file]));
    const plansByPath = new Map(plan.entries.map((entry) => [entry.path, entry]));
    const entryPlan = upload.entryPath ? plansByPath.get(upload.entryPath) : undefined;
    const assetPlans = entryPlan
      ? plan.entries.filter((entry) => entry.id !== entryPlan.id)
      : plan.entries;
    const uploadPlans = async (entries: PublicFileUploadPlanEntry[]) =>
      mapSettledWithConcurrency(entries, UPLOAD_CONCURRENCY, async (entry) => {
        const file = filesById.get(entry.id);
        if (!file) throw new Error(`Missing local file for ${entry.path}`);
        await putPublicFile(file, entry, deps.fetch ?? fetch);
      });

    const assetErrors = await uploadPlans(assetPlans);
    if (assetErrors.length > 0) throw uploadFailure(assetErrors);
    if (entryPlan) {
      const entryErrors = await uploadPlans([entryPlan]);
      if (entryErrors.length > 0) throw uploadFailure(entryErrors);
    }

    const entryUrl = entryPlan?.publicUrl ?? null;
    if (jsonRequested(opts)) {
      outJson({
        uploaded: upload.files.length,
        overwrite: Boolean(opts.overwrite),
        destination: upload.destination,
        url: entryUrl,
      });
      return;
    }
    console.log(entryUrl ?? `Uploaded ${upload.files.length} files to ${upload.destination}`);
  } catch (exception) {
    handleHttp(exception);
  }
}

async function listPublic(
  command: Command,
  path: string | undefined,
  opts: { recursive?: boolean; json?: boolean },
  deps: PublicCommandDeps,
) {
  const client = deps.createClient?.() ?? createClient();
  try {
    const publicFiles = client.space(resolveSpace(command)).publicFiles;
    const entries: PublicFileListEntry[] = [];
    let cursor: string | undefined;
    do {
      const page = await publicFiles.list(path ?? "", {
        recursive: opts.recursive,
        limit: 1000,
        cursor,
      });
      if (jsonRequested(opts)) entries.push(...page.entries);
      else for (const entry of page.entries) {
        console.log(`${terminalText(entry.name)}${entry.kind === "directory" ? "/" : ""}`);
      }
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    if (jsonRequested(opts)) return outJson({ path: path ?? "", entries, nextCursor: null });
  } catch (exception) {
    handleHttp(exception);
  }
}

async function printPublicUrl(command: Command, path: string, deps: PublicCommandDeps) {
  const client = deps.createClient?.() ?? createClient();
  try {
    const result = await client.space(resolveSpace(command)).publicFiles.url(path);
    console.log(result.url);
  } catch (exception) {
    handleHttp(exception);
  }
}

async function confirmRecursiveDelete(path: string, opts: { yes?: boolean }) {
  if (opts.yes) return;
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return error("Confirmation required", "Pass --yes to remove a public directory.");
  }
  process.stdout.write(`Remove all public files under ${path}/? [y/N] `);
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
    break;
  }
  const answer = Buffer.concat(chunks).toString().trim().toLowerCase();
  if (answer !== "y" && answer !== "yes") return error("Cancelled");
}

async function removePublic(
  command: Command,
  path: string,
  opts: { recursive?: boolean; yes?: boolean; json?: boolean },
  deps: PublicCommandDeps,
) {
  if (opts.recursive) await confirmRecursiveDelete(path, opts);
  const client = deps.createClient?.() ?? createClient();
  try {
    const publicFiles = client.space(resolveSpace(command)).publicFiles;
    let deleted = 0;
    let result: PublicFileDeleteResponse;
    do {
      result = await publicFiles.delete(path, Boolean(opts.recursive));
      deleted += result.deleted ?? 0;
      if (result.hasMore && result.deleted === 0) throw new Error("Public directory deletion made no progress");
    } while (opts.recursive && result.hasMore);
    const output = { path: result.path, deleted, hasMore: false };
    if (jsonRequested(opts)) return outJson(output);
    console.log(opts.recursive
      ? `Removed ${deleted} files from ${result.path}/`
      : `Removed ${result.path}`);
  } catch (exception) {
    handleHttp(exception);
  }
}

export function registerPublic(program: Command, deps: PublicCommandDeps = {}) {
  const publicCommand = program
    .command("public")
    .description("Upload and manage public Space files");

  publicCommand
    .command("upload <source> [destination]")
    .description("Upload a file or directory")
    .option("--overwrite", "Replace existing public files")
    .action((source: string, destination: string | undefined, opts: { overwrite?: boolean; json?: boolean }, command: Command) =>
      uploadPublic(command, source, destination, opts, deps));

  publicCommand
    .command("ls [path]")
    .description("List public files")
    .option("-r, --recursive", "List files recursively")
    .action((path: string | undefined, opts: { recursive?: boolean; json?: boolean }, command: Command) =>
      listPublic(command, path, opts, deps));

  publicCommand
    .command("url <path>")
    .description("Print a public file URL")
    .action((path: string, _opts: object, command: Command) => printPublicUrl(command, path, deps));

  publicCommand
    .command("rm <path>")
    .description("Remove a public file")
    .option("-r, --recursive", "Remove a public directory")
    .option("--yes", "Skip confirmation")
    .action((path: string, opts: { recursive?: boolean; yes?: boolean; json?: boolean }, command: Command) =>
      removePublic(command, path, opts, deps));

  return publicCommand;
}
