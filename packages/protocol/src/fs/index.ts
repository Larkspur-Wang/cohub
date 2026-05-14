export type SpaceFsChange = {
  path?: string;
  oldPath?: string;
  kind: "create" | "modify" | "delete" | "rename";
  nodeType?: "file" | "dir" | "unknown";
  mtimeMs?: number;
  size?: number;
};

export type SpaceFsChangedPayload = {
  source: "sandbox-inotify" | "api-fs" | "bootstrap" | "sandbox-watch-started";
  seq?: number;
  resync?: boolean;
  changes: SpaceFsChange[];
};

export type SpaceFsEntry = {
  name: string;
  path: string;
  type: "file" | "dir" | "symlink";
  size: number;
  mimeType: string | null;
  mtimeMs: number;
};

export type SpaceFsTreeResponse = {
  path: string;
  entries: SpaceFsEntry[];
};

export type SpaceFsFileKind = "text" | "binary";
export type SpaceFsEncoding = "utf-8" | "base64";

export type SpaceFsFileResponse = {
  path: string;
  name: string;
  size: number;
  mimeType: string | null;
  mtimeMs: number;
  kind: SpaceFsFileKind;
  encoding: SpaceFsEncoding;
  content: string;
  delivery?: "inline" | "url";
  url?: string;
};

export type SpaceFsReadFilesInput = {
  paths: string[];
};

export type SpaceFsReadFilesError = {
  path: string;
  code: string;
  message: string;
  status: number;
};

export type SpaceFsPreparingFile = {
  path: string;
  name: string;
  size: number;
  mimeType: string | null;
  mtimeMs: number;
  retryAfterMs: number;
};

export type SpaceFsReadFilesResponse = {
  files: SpaceFsFileResponse[];
  preparing?: SpaceFsPreparingFile[];
  errors: SpaceFsReadFilesError[];
};

export type SpaceFsWriteFileInput = {
  path: string;
  content: string;
  encoding: SpaceFsEncoding;
};

export type SpaceFsMoveInput = {
  fromPath: string;
  toPath: string;
};

export type SpaceFsUploadEntry = {
  path: string;
  name: string;
  size: number;
  mimeType: string | null;
  mtimeMs: number;
};

export type SpaceFsUploadError = {
  name: string;
  code: "file_too_large" | "name_invalid" | "path_invalid" | "write_failed" | "object_missing";
  message: string;
};

export type SpaceFsUploadResponse = {
  uploaded: SpaceFsUploadEntry[];
  errors: SpaceFsUploadError[];
};

export type SpaceFsUploadPlanEntryInput = {
  id: string;
  name: string;
  relativePath: string;
  size: number;
  mimeType?: string | null;
  lastModified?: number;
};

export type SpaceFsCreateUploadInput = {
  targetDir?: string;
  entries: SpaceFsUploadPlanEntryInput[];
};

export type SpaceFsUploadPlanEntry = {
  id: string;
  objectKey: string;
  uploadUrl: string;
  headers?: Record<string, string>;
};

export type SpaceFsCreateUploadResponse = {
  uploadId: string;
  expiresAt: string;
  entries: SpaceFsUploadPlanEntry[];
};

export type SpaceFsCompleteUploadInput = {
  entries: Array<{ id: string; etag?: string | null }>;
};

export type SpaceFsCompleteUploadResponse = {
  ok: true;
  taskRunId: string;
};

export type SpaceFsUploadProgress = {
  phase: "queued" | "importing" | "done" | "failed";
  totalFiles: number;
  importedFiles: number;
  totalBytes: number;
  importedBytes: number;
  currentPath?: string;
  errors: SpaceFsUploadError[];
};
