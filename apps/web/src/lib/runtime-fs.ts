export type RuntimeFsEntry = {
  name: string;
  path: string;
  type: "file" | "dir" | "symlink";
  size: number;
  mimeType: string | null;
  mtimeMs: number;
};

export type RuntimeFsNode = RuntimeFsEntry & {
  children: RuntimeFsNode[];
  isOpen: boolean;
  isLoaded: boolean;
  isLoading: boolean;
};
