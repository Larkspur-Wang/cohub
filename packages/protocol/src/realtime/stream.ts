import type { ContentBlock } from "../core/content.js";

export type SessionStreamEvent = {
  type: "stream_update";
  spaceId: string;
  sessionId: string;
  turnId?: string | null;
  seq: number;
  baseSeq: number;
  content: ContentBlock[];
  snapshotContent?: ContentBlock[];
  sourceMessageId: string | null;
  timestamp: number;
  turnEnd?: boolean;
  anchorUserMessageId?: string | null;
};

export type SessionStreamError = {
  type: "error";
  spaceId: string;
  sessionId: string | null;
  error: string;
};
