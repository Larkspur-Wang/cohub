import type { BoardSnapshot } from "./board.js";

export type WorkContentKind = "web" | "file" | "board";

export type WorkArtifactDownloadDescriptor = {
  artifactRootKey: string;
  manifestKey: string;
  manifestSha256: string;
};

export type WorkArtifactDescriptor =
  | ((
      | {
          kind: "web";
          mimeType: "text/html";
          sizeBytes: number;
          fileCount: number;
        }
      | {
          kind: "file";
          name: string;
          mimeType: string | null;
          sizeBytes: number;
          sha256: string;
        }
    ) & {
      download?: WorkArtifactDownloadDescriptor;
    })
  | {
      kind: "board";
      boardId: string;
      boardVersion: number;
      sizeBytes: number;
      fileCount: number;
    };

export type WorkArtifactManifestFile = {
  /** Path below the immutable artifact's content root. */
  artifactPath: string;
  /** Safe relative path restored by download clients. */
  outputPath: string;
  mimeType: string | null;
  sizeBytes: number;
  sha256: string;
};

export type WorkArtifactManifest = {
  kind: "cohub.work.artifact-manifest";
  version: 1;
  targetType: "file" | "directory";
  targetRef: string;
  entrypoint: string;
  fileCount: number;
  sizeBytes: number;
  files: WorkArtifactManifestFile[];
};

export type WorkBoardAsset = {
  sourcePath: string;
  status: "captured" | "missing" | "rejected";
  reason?: string;
  artifactPath?: string;
  mimeType?: string | null;
  sizeBytes?: number;
  sha256?: string;
};

export type WorkBoardArtifactManifest = {
  kind: "cohub.work.board";
  version: 1;
  sourcePath: string;
  snapshot: BoardSnapshot;
  assets: WorkBoardAsset[];
};
