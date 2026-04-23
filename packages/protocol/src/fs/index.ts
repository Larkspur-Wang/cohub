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
