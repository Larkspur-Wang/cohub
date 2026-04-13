export type RuntimeFsEntry = {
  name: string;
  path: string;
  type: "file" | "dir" | "symlink";
  size: number;
  mimeType: string | null;
  mtimeMs: number;
};

export type RuntimeFsTreeResponse = {
  path: string;
  entries: RuntimeFsEntry[];
};

export type RuntimeFsFileKind = "text" | "binary";
export type RuntimeFsEncoding = "utf-8" | "base64";

export type RuntimeFsFileResponse = {
  path: string;
  name: string;
  size: number;
  mimeType: string | null;
  mtimeMs: number;
  kind: RuntimeFsFileKind;
  encoding: RuntimeFsEncoding;
  content: string;
};

export type RuntimeFsWriteFileInput = {
  path: string;
  content: string;
  encoding: RuntimeFsEncoding;
};

export type RuntimeFsMoveInput = {
  fromPath: string;
  toPath: string;
};
