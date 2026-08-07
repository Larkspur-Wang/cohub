import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { link, lstat, mkdir, mkdtemp, rename, rm, rmdir } from "node:fs/promises";
import { basename, dirname, join, posix, resolve } from "node:path";
import { Readable, Transform, type TransformCallback } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { WorkArtifactManifest, WorkArtifactManifestFile, WorkGetResponse } from "@neta-art/cohub";

const MANIFEST_MAX_BYTES = 4 * 1024 * 1024;
const DOWNLOAD_CONCURRENCY = 4;

type DownloadResult = {
  workId: string;
  version: number;
  kind: "file" | "directory";
  output: string;
  files: number;
  bytes: number;
  verified: true;
};

function safeRelativePath(value: string, label: string) {
  if (!value || value.includes("\\") || value.includes("\0") || posix.isAbsolute(value)) {
    throw new Error(`Invalid ${label} in Work manifest`);
  }
  const segments = value.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error(`Invalid ${label} in Work manifest`);
  }
  return posix.normalize(value);
}

function isManifestFile(value: unknown): value is WorkArtifactManifestFile {
  if (!value || typeof value !== "object") return false;
  const file = value as Partial<WorkArtifactManifestFile>;
  return typeof file.artifactPath === "string"
    && typeof file.outputPath === "string"
    && (typeof file.mimeType === "string" || file.mimeType === null)
    && Number.isSafeInteger(file.sizeBytes)
    && Number(file.sizeBytes) >= 0
    && typeof file.sha256 === "string"
    && /^[0-9a-f]{64}$/i.test(file.sha256);
}

function parseManifest(value: unknown): WorkArtifactManifest {
  if (!value || typeof value !== "object") throw new Error("Work download manifest is invalid");
  const manifest = value as Partial<WorkArtifactManifest>;
  if (
    manifest.kind !== "cohub.work.artifact-manifest"
    || manifest.version !== 1
    || (manifest.targetType !== "file" && manifest.targetType !== "directory")
    || typeof manifest.targetRef !== "string"
    || typeof manifest.entrypoint !== "string"
    || !Number.isSafeInteger(manifest.fileCount)
    || Number(manifest.fileCount) < 1
    || !Number.isSafeInteger(manifest.sizeBytes)
    || Number(manifest.sizeBytes) < 0
    || !Array.isArray(manifest.files)
    || !manifest.files.every(isManifestFile)
    || manifest.files.length !== manifest.fileCount
  ) {
    throw new Error("Work download manifest is invalid");
  }

  const seenArtifactPaths = new Set<string>();
  const seenOutputPaths = new Set<string>();
  let sizeBytes = 0;
  for (const file of manifest.files) {
    file.artifactPath = safeRelativePath(file.artifactPath, "artifact path");
    file.outputPath = safeRelativePath(file.outputPath, "output path");
    if (seenArtifactPaths.has(file.artifactPath) || seenOutputPaths.has(file.outputPath)) {
      throw new Error("Work download manifest contains duplicate paths");
    }
    seenArtifactPaths.add(file.artifactPath);
    seenOutputPaths.add(file.outputPath);
    sizeBytes += file.sizeBytes;
  }
  if (sizeBytes !== manifest.sizeBytes) throw new Error("Work download manifest size is invalid");
  safeRelativePath(manifest.entrypoint, "entrypoint");
  return manifest as WorkArtifactManifest;
}

async function readManifest(url: string, expectedSha256: string, fetcher: typeof fetch) {
  const response = await fetcher(url);
  if (!response.ok) throw new Error(`Failed to download Work manifest (${response.status})`);
  if (!response.body) throw new Error("Work download manifest is invalid");
  const contentLength = Number(response.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > MANIFEST_MAX_BYTES) {
    throw new Error("Work download manifest is too large");
  }

  const chunks: Buffer[] = [];
  let sizeBytes = 0;
  for await (const chunk of Readable.fromWeb(response.body as never)) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    sizeBytes += bytes.byteLength;
    if (sizeBytes > MANIFEST_MAX_BYTES) throw new Error("Work download manifest is too large");
    chunks.push(bytes);
  }
  const bytes = Buffer.concat(chunks, sizeBytes);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (sha256 !== expectedSha256) throw new Error("Work download manifest checksum mismatch");
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString("utf8")) as unknown;
  } catch {
    throw new Error("Work download manifest is invalid");
  }
  return parseManifest(parsed);
}

function artifactUrl(contentUrl: string, artifactPath: string) {
  const base = new URL("./", contentUrl);
  const encodedPath = safeRelativePath(artifactPath, "artifact path")
    .split("/")
    .map(encodeURIComponent)
    .join("/");
  return new URL(encodedPath, base).toString();
}

async function downloadFile(url: string, output: string, expected: WorkArtifactManifestFile, fetcher: typeof fetch) {
  const response = await fetcher(url);
  if (!response.ok || !response.body) throw new Error(`Failed to download ${expected.outputPath} (${response.status})`);
  await mkdir(dirname(output), { recursive: true });

  let sizeBytes = 0;
  const hash = createHash("sha256");
  const verifier = new Transform({
    transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback) {
      sizeBytes += chunk.byteLength;
      if (sizeBytes > expected.sizeBytes) {
        callback(new Error(`Downloaded file verification failed: ${expected.outputPath}`));
        return;
      }
      hash.update(chunk);
      callback(null, chunk);
    },
  });
  await pipeline(
    Readable.fromWeb(response.body as never),
    verifier,
    createWriteStream(output, { flags: "wx" }),
  );
  if (sizeBytes !== expected.sizeBytes || hash.digest("hex") !== expected.sha256) {
    throw new Error(`Downloaded file verification failed: ${expected.outputPath}`);
  }
}

function outputExistsError(output: string) {
  return new Error(`Output already exists: ${output}`);
}

async function outputExists(output: string) {
  return Boolean(await lstat(output).catch((cause: NodeJS.ErrnoException) => {
    if (cause.code === "ENOENT") return null;
    throw cause;
  }));
}

async function assertOutputMissing(output: string) {
  if (await outputExists(output)) throw outputExistsError(output);
}

async function installFileNoReplace(stagedFile: string, output: string) {
  try {
    await link(stagedFile, output);
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "EEXIST") throw outputExistsError(output);
    throw cause;
  }
}

async function installDirectoryNoReplace(stage: string, output: string) {
  if (process.platform === "win32") {
    try {
      // Windows directory renames already fail when the destination exists.
      await rename(stage, output);
      return;
    } catch (cause) {
      if (await outputExists(output)) throw outputExistsError(output);
      throw cause;
    }
  }

  try {
    await mkdir(output);
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "EEXIST") throw outputExistsError(output);
    throw cause;
  }

  try {
    await rename(stage, output);
  } catch (cause) {
    await rmdir(output).catch(() => undefined);
    throw cause;
  }
}

async function downloadFiles(input: {
  files: WorkArtifactManifestFile[];
  contentUrl: string;
  stage: string;
  fetcher: typeof fetch;
}) {
  let next = 0;
  let failed = false;
  let failure: unknown;
  const workers = Array.from({ length: Math.min(DOWNLOAD_CONCURRENCY, input.files.length) }, async () => {
    while (!failed && next < input.files.length) {
      const index = next++;
      const file = input.files[index];
      if (!file) continue;
      try {
        await downloadFile(
          artifactUrl(input.contentUrl, file.artifactPath),
          join(input.stage, ...file.outputPath.split("/")),
          file,
          input.fetcher,
        );
      } catch (cause) {
        if (!failed) failure = cause;
        failed = true;
      }
    }
  });
  await Promise.all(workers);
  if (failed) throw failure;
}

export async function downloadWork(
  detail: WorkGetResponse,
  outputOption?: string,
  fetcher: typeof fetch = fetch,
): Promise<DownloadResult> {
  const { work, content } = detail;
  if (!content) throw new Error("This Work has no published downloadable artifact");
  if (content.kind === "port") throw new Error("Port Works do not have a downloadable artifact");
  if (content.kind === "board") throw new Error("Board Works do not have a restorable file or directory artifact");
  if (!content.download) throw new Error("This Work version does not support download");

  const manifest = await readManifest(content.download.manifestUrl, content.download.manifestSha256, fetcher);
  if (manifest.targetType !== content.targetType || manifest.targetRef !== content.path) {
    throw new Error("Work download manifest does not match the published artifact");
  }

  const entry = manifest.files.find((file) => file.artifactPath === manifest.entrypoint);
  if (!entry) throw new Error("Work download manifest entrypoint is missing");
  const hasDirectoryOutput = manifest.targetType === "directory" || manifest.files.length > 1;
  const output = resolve(outputOption ?? (hasDirectoryOutput ? work.slug : basename(manifest.targetRef)));
  await assertOutputMissing(output);
  await mkdir(dirname(output), { recursive: true });
  const stage = await mkdtemp(join(dirname(output), `.${basename(output)}.cohub-download-`));

  try {
    const files = hasDirectoryOutput ? manifest.files : [entry];
    await downloadFiles({ files, contentUrl: content.url, stage, fetcher });
    if (hasDirectoryOutput) {
      await installDirectoryNoReplace(stage, output);
    } else {
      const stagedFile = join(stage, ...entry.outputPath.split("/"));
      await installFileNoReplace(stagedFile, output);
      await rm(stage, { recursive: true, force: true });
    }
    return {
      workId: work.id,
      version: work.latestVersion,
      kind: hasDirectoryOutput ? "directory" : "file",
      output,
      files: files.length,
      bytes: files.reduce((sum, file) => sum + file.sizeBytes, 0),
      verified: true,
    };
  } catch (cause) {
    await rm(stage, { recursive: true, force: true }).catch(() => undefined);
    throw cause;
  }
}
