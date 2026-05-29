import { access, appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { AgentMessage } from "@earendil-works/pi-agent-core";

export type SessionHeader = {
  type: "session";
  version?: number;
  id: string;
  timestamp: string;
  cwd: string;
  parentSession?: string;
};

export type SessionEntryBase = {
  type: string;
  id: string;
  parentId: string | null;
  timestamp: string;
};

export type SessionMessageEntry = SessionEntryBase & {
  type: "message";
  message: AgentMessage;
};

export type ThinkingLevelChangeEntry = SessionEntryBase & {
  type: "thinking_level_change";
  thinkingLevel: string;
};

export type ModelChangeEntry = SessionEntryBase & {
  type: "model_change";
  provider: string;
  modelId: string;
};

export type CompactionEntry = SessionEntryBase & {
  type: "compaction";
  summary: string;
  firstKeptEntryId: string;
  tokensBefore: number;
  details?: unknown;
  fromHook?: boolean;
};

export type CustomEntry = SessionEntryBase & {
  type: "custom";
  customType: string;
  data?: unknown;
};

export type CustomMessageEntry = SessionEntryBase & {
  type: "custom_message";
  customType: string;
  content: unknown;
  display: boolean;
  details?: unknown;
};

export type SessionInfoEntry = SessionEntryBase & {
  type: "session_info";
  name?: string;
};

export type SessionEntry =
  | SessionMessageEntry
  | ThinkingLevelChangeEntry
  | ModelChangeEntry
  | CompactionEntry
  | CustomEntry
  | CustomMessageEntry
  | SessionInfoEntry;

export type FileEntry = SessionHeader | SessionEntry;

export type SessionContext = {
  messages: AgentMessage[];
  thinkingLevel: string;
  model: { provider: string; modelId: string } | null;
};

function nowIso() {
  return new Date().toISOString();
}

function generateEntryId(existing: Set<string>) {
  for (let i = 0; i < 100; i++) {
    const id = randomUUID().slice(0, 8);
    if (!existing.has(id)) return id;
  }
  return randomUUID();
}

function createSessionId() {
  return randomUUID();
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function parseEntries(path: string): Promise<FileEntry[]> {
  if (!(await pathExists(path))) return [];
  const lines = (await readFile(path, "utf-8")).split(/\r?\n/).filter(Boolean);
  const entries: FileEntry[] = [];
  for (const line of lines) {
    entries.push(JSON.parse(line) as FileEntry);
  }
  return entries;
}

export class SessionManager {
  private header: SessionHeader | null = null;
  private entries: SessionEntry[] = [];
  private byId = new Map<string, SessionEntry>();
  private leafId: string | null = null;
  public sessionFile?: string;
  private fileReady = false;
  private writeChain: Promise<void> = Promise.resolve();
  private writeError: unknown = null;

  private constructor(
    private readonly cwd: string,
    private readonly sessionDir: string,
    sessionFile?: string,
    parsed: FileEntry[] = [],
  ) {
    this.sessionFile = sessionFile;
    if (parsed.length > 0) {
      this.header = (parsed.find((entry) => entry.type === "session") as SessionHeader | undefined) ?? null;
      this.entries = parsed.filter((entry) => entry.type !== "session") as SessionEntry[];
      this.rebuildIndex();
      this.fileReady = Boolean(sessionFile && this.header);
    }
  }

  static create(cwd: string, sessionDir: string): SessionManager {
    return new SessionManager(cwd, sessionDir);
  }

  static async open(path: string, sessionDir: string): Promise<SessionManager> {
    const parsed = await parseEntries(path);
    const header = parsed.find((entry) => entry.type === "session") as SessionHeader | undefined;
    const cwd = header?.cwd ?? process.cwd();
    return new SessionManager(cwd, sessionDir, path, parsed);
  }

  setSessionFile(path: string) {
    this.sessionFile = path;
    this.fileReady = false;
    this.rewriteFile();
  }

  async flush(): Promise<void> {
    await this.writeChain;
    if (this.writeError) {
      throw this.writeError;
    }
  }

  getEntries(): SessionEntry[] {
    return [...this.entries];
  }

  newSession(options: { id?: string; parentSession?: string }) {
    this.header = {
      type: "session",
      version: 3,
      id: options.id ?? createSessionId(),
      timestamp: nowIso(),
      cwd: this.cwd,
      parentSession: options.parentSession,
    };
    this.entries = [];
    this.byId.clear();
    this.leafId = null;
    this.fileReady = false;
    this.rewriteFile();
  }

  buildSessionContext(): SessionContext {
    const branch = this.getBranch();
    const messages: AgentMessage[] = [];
    let thinkingLevel = "off";
    let model: { provider: string; modelId: string } | null = null;
    for (const entry of branch) {
      if (entry.type === "message") {
        messages.push(entry.message);
      } else if (entry.type === "thinking_level_change") {
        thinkingLevel = entry.thinkingLevel;
      } else if (entry.type === "model_change") {
        model = { provider: entry.provider, modelId: entry.modelId };
      } else if (entry.type === "custom_message") {
        messages.push({ role: "user", content: entry.content as never, timestamp: Date.now() } as AgentMessage);
      }
    }
    return { messages, thinkingLevel, model };
  }

  appendMessage(message: AgentMessage): string {
    const entry: SessionMessageEntry = {
      type: "message",
      id: generateEntryId(new Set(this.entries.map((item) => item.id))),
      parentId: this.leafId,
      timestamp: nowIso(),
      message,
    };
    this.appendEntry(entry);
    return entry.id;
  }

  appendModelChange(provider: string, modelId: string): string {
    const entry: ModelChangeEntry = {
      type: "model_change",
      id: generateEntryId(new Set(this.entries.map((item) => item.id))),
      parentId: this.leafId,
      timestamp: nowIso(),
      provider,
      modelId,
    };
    this.appendEntry(entry);
    return entry.id;
  }

  appendThinkingLevelChange(thinkingLevel: string): string {
    const entry: ThinkingLevelChangeEntry = {
      type: "thinking_level_change",
      id: generateEntryId(new Set(this.entries.map((item) => item.id))),
      parentId: this.leafId,
      timestamp: nowIso(),
      thinkingLevel,
    };
    this.appendEntry(entry);
    return entry.id;
  }

  appendCompaction(summary: string, firstKeptEntryId: string, tokensBefore: number, details?: unknown, fromHook?: boolean): string {
    const entry: CompactionEntry = {
      type: "compaction",
      id: generateEntryId(new Set(this.entries.map((item) => item.id))),
      parentId: this.leafId,
      timestamp: nowIso(),
      summary,
      firstKeptEntryId,
      tokensBefore,
      details,
      fromHook,
    };
    this.appendEntry(entry);
    return entry.id;
  }

  appendCustomEntry(customType: string, data?: unknown): string {
    const entry: CustomEntry = {
      type: "custom",
      id: generateEntryId(new Set(this.entries.map((item) => item.id))),
      parentId: this.leafId,
      timestamp: nowIso(),
      customType,
      data,
    };
    this.appendEntry(entry);
    return entry.id;
  }

  appendCustomMessageEntry(customType: string, content: unknown, display: boolean, details?: unknown): string {
    const entry: CustomMessageEntry = {
      type: "custom_message",
      id: generateEntryId(new Set(this.entries.map((item) => item.id))),
      parentId: this.leafId,
      timestamp: nowIso(),
      customType,
      content,
      display,
      details,
    };
    this.appendEntry(entry);
    return entry.id;
  }

  appendSessionInfo(name: string): string {
    const entry: SessionInfoEntry = {
      type: "session_info",
      id: generateEntryId(new Set(this.entries.map((item) => item.id))),
      parentId: this.leafId,
      timestamp: nowIso(),
      name,
    };
    this.appendEntry(entry);
    return entry.id;
  }

  async createBranchedSession(leafId: string, options?: { id?: string; filePath?: string; parentSession?: string }): Promise<string | undefined> {
    await this.flush();
    const pathEntries = this.getBranch(leafId);
    if (pathEntries.length === 0) {
      throw new Error(`Entry ${leafId} not found`);
    }
    const newSessionId = options?.id ?? createSessionId();
    const newSessionFile = options?.filePath ?? join(this.sessionDir, `${newSessionId}.jsonl`);
    const header: SessionHeader = {
      type: "session",
      version: 3,
      id: newSessionId,
      timestamp: nowIso(),
      cwd: this.cwd,
      parentSession: options?.parentSession ?? this.sessionFile,
    };
    await mkdir(this.sessionDir, { recursive: true });
    const lines = `${[JSON.stringify(header), ...pathEntries.map((entry) => JSON.stringify(entry))].join("\n")}\n`;
    await writeFile(newSessionFile, lines, "utf-8");
    return newSessionFile;
  }

  private appendEntry(entry: SessionEntry) {
    this.entries.push(entry);
    this.byId.set(entry.id, entry);
    this.leafId = entry.id;
    this.appendToFile(entry);
  }

  private enqueueWrite(label: string, task: () => Promise<void>) {
    if (this.writeError) return;

    this.writeChain = this.writeChain
      .then(async () => {
        if (this.writeError) return;
        await task();
      })
      .catch((error) => {
        this.writeError = error;
        console.error(`[SessionManager] Failed to write session file (${label}) ${this.sessionFile ?? "<unset>"}:`, error);
      });
  }

  private appendToFile(entry: SessionEntry) {
    if (!this.sessionFile) return;
    if (!this.fileReady) {
      this.rewriteFile();
      return;
    }

    this.enqueueWrite(`append:${entry.id}`, async () => {
      if (!this.sessionFile) return;
      await mkdir(this.sessionDir, { recursive: true });
      await appendFile(this.sessionFile, `${JSON.stringify(entry)}\n`, "utf-8");
    });
  }

  private rewriteFile() {
    if (!this.sessionFile || !this.header) return;
    this.enqueueWrite("rewrite", async () => {
      if (!this.sessionFile || !this.header) return;
      await mkdir(this.sessionDir, { recursive: true });
      const lines = [JSON.stringify(this.header), ...this.entries.map((entry) => JSON.stringify(entry))].join("\n");
      await writeFile(this.sessionFile, `${lines}${lines ? "\n" : ""}`, "utf-8");
      this.fileReady = true;
    });
  }

  private rebuildIndex() {
    this.byId = new Map(this.entries.map((entry) => [entry.id, entry]));
    this.leafId = this.entries.at(-1)?.id ?? null;
  }

  private getBranch(fromId?: string): SessionEntry[] {
    const targetId = fromId ?? this.leafId;
    if (!targetId) return [];
    const path: SessionEntry[] = [];
    let current = this.byId.get(targetId) ?? null;
    while (current) {
      path.push(current);
      current = current.parentId ? (this.byId.get(current.parentId) ?? null) : null;
    }
    return path.reverse();
  }
}
