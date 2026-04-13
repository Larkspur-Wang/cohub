import type { RuntimeFsEntry } from "@cohub/protocol";

export type RuntimeFsNode = RuntimeFsEntry & {
  children: RuntimeFsNode[];
  isOpen: boolean;
  isLoaded: boolean;
  isLoading: boolean;
};
