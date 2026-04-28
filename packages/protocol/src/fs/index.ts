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
  code: "file_too_large" | "name_invalid" | "write_failed";
  message: string;
};

export type SpaceFsUploadResponse = {
  uploaded: SpaceFsUploadEntry[];
  errors: SpaceFsUploadError[];
};
