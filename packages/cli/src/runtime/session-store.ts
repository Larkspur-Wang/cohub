import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, stat, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { contextToPiMessages, runtimeEventSchema, type RuntimeExecutionEvent, type HarnessArchive, type RuntimeTurnInput } from "@neta-art/cohub";
import { codexArchiveTotals, type CodexTokenTotals } from "./codex-usage.js";

export class ContextRequiredError extends Error {}

export type NativeSession = {
  version: 1;
  sessionId: string;
  harness: "pi" | "codex";
  nativeSessionId: string;
  path: string;
  cwd?: string;
  throughTurnId: string | null;
  revision: string;
  checksum: string;
  pendingTurnId: string | null;
  resultChecksum?: string;
  codexTokenTotals?: CodexTokenTotals;
};
const checksum = (data: string) => createHash("sha256").update(data).digest("hex");
const missing = (error: unknown) => (error as NodeJS.ErrnoException)?.code === "ENOENT";
// Cap what this host sends over the WebSocket; larger sessions stay local-only.
const NATIVE_ARCHIVE_MAX_BYTES = 24 * 1024 * 1024;

async function atomicJson(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    const file = await open(temporary, "wx", 0o600);
    try { await file.writeFile(JSON.stringify(value)); await file.sync(); } finally { await file.close(); }
    await rename(temporary, path);
    if (process.platform !== "win32") {
      const directory = await open(dirname(path), "r");
      try { await directory.sync(); } finally { await directory.close(); }
    }
  } finally { await rm(temporary, { force: true }); }
}

/** Local references are hints validated against actual native files, never cloud existence claims. */
export class RuntimeSessionStore {
  readonly root: string;
  constructor(spaceId: string, stateRoot = join(homedir(), ".local", "state", "cohub", "runtime")) { this.root = join(stateRoot, spaceId); }
  private statePath(input: Pick<RuntimeTurnInput, "sessionId" | "harness">) { return join(this.root, input.harness, `${input.sessionId}.json`); }
  async pendingTurnIds(sessionId: string): Promise<string[]> {
    const ids: string[] = [];
    for (const harness of ["pi", "codex"] as const) {
      try {
        const state = JSON.parse(await readFile(this.statePath({ sessionId, harness }), "utf8")) as NativeSession;
        if (state.sessionId !== sessionId || state.harness !== harness) throw new Error("Local session identity mismatch");
        if (state.pendingTurnId) ids.push(state.pendingTurnId);
      } catch (error) { if (!missing(error)) throw error; }
    }
    return ids;
  }
  async prepare(input: RuntimeTurnInput, cwd: string): Promise<{ state: NativeSession; resume: "native" | "restored" | "handoff" | "new" }> {
    let previous: NativeSession | null = null;
    try { previous = JSON.parse(await readFile(this.statePath(input), "utf8")) as NativeSession; }
    catch (error) { if (!missing(error)) throw new Error("Local session state is unreadable; original files were preserved", { cause: error }); }
    if (previous) {
      if (previous.sessionId !== input.sessionId || previous.harness !== input.harness) throw new Error("Local session identity mismatch");
      const pending = previous.pendingTurnId;
      if (pending) {
        const resolved = input.context.resolvedTurnIds?.includes(pending) === true;
        const settled = input.context.settledTurnIds?.includes(pending) === true;
        const lostAcknowledgement = Boolean(previous.resultChecksum) && pending === input.context.throughTurnId && pending !== input.turnId;
        // A human-confirmed stop is authoritative: rebuild from durable history instead of
        // resuming a native projection whose outcome the server never recorded.
        const retire = resolved || (settled && !lostAcknowledgement);
        const nativeChecksum = await readFile(previous.path, "utf8").then(checksum).catch((error) => { if (missing(error)) return null; throw error; });
        if (previous.resultChecksum && (settled || resolved) && nativeChecksum && nativeChecksum !== previous.resultChecksum) {
          throw new Error("Native session changed outside Cohub; original data was preserved");
        }
        if (retire) {
          // The server reached a terminal state for this turn. Archive the local projection and
          // rebuild from durable context; native files are never deleted, so nothing is lost.
          const receipt = await readFile(this.resultPath(previous), "utf8").catch((error) => { if (missing(error)) return null; throw error; });
          const retired = { state: previous, receipt };
          await atomicJson(join(this.root, "retired", `${pending}.${checksum(JSON.stringify(retired))}.json`), retired);
          previous = null;
        } else if (lostAcknowledgement) {
          // The server already persisted this turn; only our acknowledgement was lost.
          await this.acknowledge(previous, pending, input.context.revision);
        } else if (input.context.complete === false) {
          throw new ContextRequiredError("Server resolution is required for the pending native execution");
        } else {
          throw new Error(`Local turn ${pending} has unconfirmed results; reconcile it before continuing`);
        }
      }
    }
    if (previous) {
      try {
        const data = await readFile(previous.path, "utf8");
        if (checksum(data) !== previous.checksum) throw new Error("Native session changed outside Cohub; original data was preserved");
        if (input.harness === "codex" && !previous.codexTokenTotals) previous.codexTokenTotals = codexArchiveTotals(data.split("\n").filter((line) => line.trim()).map((line) => JSON.parse(line)));
        if (previous.cwd === cwd && previous.throughTurnId === input.context.throughTurnId && previous.revision === input.context.revision) return { state: previous, resume: "native" };
      } catch (error) { if (!missing(error)) throw error; }
    }
    if (input.context.complete === false) throw new ContextRequiredError("Full context is required to materialize this session");
    const id = randomUUID();
    const path = join(this.root, input.harness, `${id}.jsonl`);
    const archive = input.context.archive;
    const restore = archive?.harness === input.harness && archive.sessionId === input.sessionId && archive.turnId === input.context.throughTurnId;
    const state: NativeSession = {
      version: 1, harness: input.harness, sessionId: input.sessionId, nativeSessionId: restore ? archive.nativeSessionId : id,
      path, cwd, throughTurnId: input.context.throughTurnId, revision: input.context.revision, checksum: "", pendingTurnId: null,
    };
    let data: string | null = restore ? archive.data : null;
    if (data != null) {
      const lines = data.split("\n").filter((line) => line.trim());
      const records = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
      const header = records[0];
      if (input.harness === "pi") {
        if (header?.type !== "session" || header.id !== state.nativeSessionId) throw new Error("Pi archive identity mismatch");
        header.cwd = cwd;
        delete header.parentSession;
      } else {
        const payload = header?.payload as Record<string, unknown> | undefined;
        if (header?.type !== "session_meta" || payload?.id !== state.nativeSessionId) throw new Error("Codex archive identity mismatch");
        // Paginated IDs depend on Codex's private SQLite index. Import a separate portable
        // projection; never rewrite the source archive or the user's existing native thread.
        payload.id = id;
        if (payload.session_id != null) payload.session_id = id;
        payload.history_mode = "legacy";
        payload.cwd = cwd;
        state.codexTokenTotals = codexArchiveTotals(records);
        state.nativeSessionId = id;
      }
      data = `${[JSON.stringify(header), ...lines.slice(1)].join("\n")}\n`;
    }
    if (!data && input.harness === "pi") {
      const entries: unknown[] = [{ type: "session", version: 3, id, cwd, timestamp: new Date().toISOString() }];
      let parentId: string | null = null;
      for (const message of contextToPiMessages(input.context.messages)) {
        const entryId = randomUUID().slice(0, 8);
        entries.push({ type: "message", id: entryId, parentId, timestamp: new Date().toISOString(), message });
        parentId = entryId;
      }
      data = `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`;
    }
    if (data != null) {
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      const file = await open(path, "wx", 0o600);
      try { await file.writeFile(data); await file.sync(); } finally { await file.close(); }
      state.checksum = checksum(data);
    }
    return { state, resume: restore ? "restored" : input.context.messages.length ? "handoff" : "new" };
  }
  async started(state: NativeSession, turnId: string) { state.pendingTurnId = turnId; state.resultChecksum = undefined; await atomicJson(this.statePath(state), state); }
  private resultPath(state: Pick<NativeSession, "sessionId" | "harness">) { return join(this.root, "results", `${state.sessionId}.${state.harness}.json`); }
  async recordResult(state: NativeSession, requestId: string, events: RuntimeExecutionEvent[]) {
    if (!state.pendingTurnId) throw new Error("Cannot record a result for an idle native session");
    state.resultChecksum = checksum(await readFile(state.path, "utf8"));
    await atomicJson(this.resultPath(state), { requestId, state, events });
    await atomicJson(this.statePath(state), state);
  }
  async recoverResult(input: Pick<RuntimeTurnInput, "sessionId" | "harness" | "turnId">, requestId?: string): Promise<{ state: NativeSession; events: RuntimeExecutionEvent[] } | null> {
    try {
      const saved = JSON.parse(await readFile(this.resultPath(input), "utf8")) as { requestId: string; state: NativeSession; events: unknown[] };
      if (saved.state.sessionId !== input.sessionId || saved.state.harness !== input.harness) throw new Error("Runtime result identity mismatch");
      if (saved.state.pendingTurnId !== input.turnId) return null;
      if (requestId && saved.requestId !== requestId) throw new Error("Runtime result execution identity mismatch");
      return { state: saved.state, events: saved.events.map((event) => runtimeEventSchema.parse(event)) };
    } catch (error) { if (missing(error)) return null; throw error; }
  }
  async archive(state: NativeSession, turnId: string): Promise<HarnessArchive | null> {
    if (!state.path) return null;
    const info = await stat(state.path);
    if (info.size > NATIVE_ARCHIVE_MAX_BYTES) return null;
    const data = await readFile(state.path, "utf8");
    return { version: 1, harness: state.harness, sessionId: state.sessionId, turnId, nativeFormat: state.harness === "pi" ? "pi.jsonl" : "codex.rollout", nativeSessionId: state.nativeSessionId, data };
  }
  async acknowledge(state: NativeSession, turnId: string, revision: string) {
    if (state.pendingTurnId !== turnId) throw new Error("Runtime acknowledgement identity mismatch");
    const currentChecksum = await readFile(state.path, "utf8").then(checksum).catch((error) => { if (missing(error)) return state.resultChecksum ?? state.checksum; throw error; });
    if (state.resultChecksum && currentChecksum !== state.resultChecksum) throw new Error("Native data changed before acknowledgement; files preserved");
    const acknowledged: NativeSession = { ...state, checksum: currentChecksum, pendingTurnId: null, resultChecksum: undefined, throughTurnId: turnId, revision };
    await atomicJson(this.statePath(state), acknowledged);
    Object.assign(state, acknowledged);
  }
}
