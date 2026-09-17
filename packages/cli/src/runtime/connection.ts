import { setTimeout as delay } from "node:timers/promises";
import { RUNTIME_MAX_FRAME_BYTES, RUNTIME_PROTOCOL_VERSION, runtimeCommandSchema, runtimeReadySchema, type RuntimeCapabilities, type RuntimeExecutionEvent, type RuntimeContext } from "@neta-art/cohub";
import { executeCodex, executePi, type HarnessOptions, type HarnessResult } from "./harness.js";
import { ProcessCleanupUncertainError } from "./process-group.js";
import { ContextRequiredError, type RuntimeSessionStore } from "./session-store.js";

type Execution = { controller: AbortController; promise: Promise<void>; sessionId: string; turnId: string; harness: "pi" | "codex"; result?: HarnessResult };

export type RuntimeConnectionOptions = {
  spaceId: string; cwd: string; url: string; capabilities: RuntimeCapabilities; harnesses: HarnessOptions;
  token: () => Promise<string>; signal: AbortSignal; store: RuntimeSessionStore;
  onReady: () => void;
  leaseConflictTimeoutMs?: number;
};

export async function serveRuntime(options: RuntimeConnectionOptions) {
  let backoff = 500;
  let conflictSince: number | null = null;
  const uploads = new AbortController();
  const uploadSignal = AbortSignal.any([options.signal, uploads.signal]);
  const flush = () => options.store.flushArchives(uploadSignal).catch((error) => {
    if (!uploadSignal.aborted) console.error("Archive pending:", error);
  });
  const timer = setInterval(() => { void flush(); }, 10_000);
  void flush();
  try {
    while (!options.signal.aborted) {
      const outcome = await connect({ ...options, onReady: () => { backoff = 500; conflictSince = null; options.onReady(); void flush(); } });
      if (options.signal.aborted) return;
      if (outcome === "fatal") throw new Error("Runtime connection rejected");
      if (outcome === "conflict") {
        conflictSince ??= Date.now();
        if (Date.now() - conflictSince >= (options.leaseConflictTimeoutMs ?? 90_000)) throw new Error("Space is already connected to another Runtime");
      }
      await delay(backoff, undefined, { signal: options.signal }).catch(() => undefined);
      backoff = Math.min(10_000, backoff * 2);
    }
  } finally {
    clearInterval(timer); uploads.abort(); await flush();
  }
}

async function connect(options: RuntimeConnectionOptions): Promise<"retry" | "fatal" | "conflict"> {
  let token = await options.token();
  const socket = new WebSocket(options.url);
  const active = new Map<string, Execution>();
  const seen = new Set<string>();
  const disconnected = new AbortController();
  const contexts = new Map<string, (context: RuntimeContext) => void>();
  let lastHeartbeat = Date.now();
  let connectionId: string | null = null;
  let fatal = false;
  let conflict = false;
  let readyTimer: ReturnType<typeof setTimeout>;
  const send = (frame: unknown) => {
    if (socket.readyState !== WebSocket.OPEN || socket.bufferedAmount > RUNTIME_MAX_FRAME_BYTES) throw new Error("Runtime connection unavailable");
    const data = JSON.stringify(frame);
    if (Buffer.byteLength(data) > RUNTIME_MAX_FRAME_BYTES) throw new Error("Runtime frame exceeds transfer limit");
    socket.send(data);
  };
  const stop = () => { for (const execution of active.values()) execution.controller.abort(); socket.close(); };
  options.signal.addEventListener("abort", stop, { once: true });
  const heartbeat = setInterval(() => {
    if (Date.now() - lastHeartbeat > 30_000) stop();
    else if (connectionId) {
      try { send({ type: "runtime.heartbeat" }); } catch { stop(); }
      void options.token().then((next) => { if (next !== token) { send({ type: "runtime.auth", token: next }); token = next; } }).catch(stop);
    }
  }, 10_000);
  const closed = new Promise<void>((resolve) => {
    socket.addEventListener("close", (event) => {
      fatal = [4400, 4401, 4403].includes(event.code);
      conflict = event.code === 4409;
      disconnected.abort();
      if (!options.signal.aborted) console.error(`Runtime disconnected (${event.code}): ${event.reason}`);
      for (const execution of active.values()) execution.controller.abort();
      resolve();
    }, { once: true });
  });
  socket.addEventListener("error", () => socket.close());
  socket.addEventListener("open", () => {
    try { send({ type: "runtime.hello", version: RUNTIME_PROTOCOL_VERSION, spaceId: options.spaceId, token, capabilities: options.capabilities }); } catch { stop(); }
  });
  socket.addEventListener("message", (event) => {
    void (async () => {
      const raw = JSON.parse(String(event.data)) as { type?: string };
      if (raw.type === "runtime.ready") {
        const frame = runtimeReadySchema.parse(raw);
        if (connectionId === frame.connectionId) return;
        if (connectionId) throw new Error("Runtime connection identity changed");
        connectionId = frame.connectionId;
        clearTimeout(readyTimer); options.onReady(); return;
      }
      if (!connectionId) throw new Error("Runtime handshake is incomplete");
      if (raw.type === "runtime.heartbeat") { lastHeartbeat = Date.now(); return; }
      const frame = runtimeCommandSchema.parse(raw);
      if (frame.type === "session.context") { contexts.get(frame.requestId)?.(frame.context); contexts.delete(frame.requestId); return; }
      if (frame.type === "turn.abort") { active.get(frame.requestId)?.controller.abort(); return; }
      if (frame.type === "turn.ack") {
        const execution = active.get(frame.requestId);
        if (!execution) return;
        try {
          await execution.promise;
          if (!execution.result) throw new Error("Runtime result is not available");
          await options.store.acknowledge(execution.result.state, frame.turnId, frame.revision);
        } catch (error) {
          console.error("Runtime acknowledgement failed; result retained:", error);
          active.delete(frame.requestId);
          send({ type: "runtime.event", requestId: frame.requestId, event: { type: "turn.error", message: "Local acknowledgement failed; result retained" } });
          return;
        }
        active.delete(frame.requestId);
        send({ type: "runtime.event", requestId: frame.requestId, event: { type: "turn.acknowledged" } });
        return;
      }
      if (frame.type === "turn.recover") {
        const identity = frame.execution;
        if (identity.spaceId !== options.spaceId) throw new Error("Invalid Runtime target");
        const previous = active.get(frame.requestId);
        if (previous) {
          if (previous.sessionId !== identity.sessionId || previous.turnId !== identity.turnId || previous.harness !== identity.harness) throw new Error("Runtime recovery identity changed");
          await previous.promise;
          const saved = await options.store.recoverResult(identity);
          if (saved) for (const event of saved.events) send({ type: "runtime.event", requestId: frame.requestId, event });
          return;
        }
        const running = [...active].find(([, entry]) => entry.turnId === identity.turnId && entry.sessionId === identity.sessionId && entry.harness === identity.harness);
        const recovery: Execution = { ...identity, controller: new AbortController(), promise: Promise.resolve() };
        active.set(frame.requestId, recovery);
        recovery.promise = (async () => {
          try {
            if (running) { running[1].controller.abort(); await running[1].promise; active.delete(running[0]); }
            const saved = await options.store.recoverResult(identity);
            recovery.controller.signal.throwIfAborted();
            const last = saved?.events.at(-1);
            if (!saved || last?.type !== "turn.end") throw new Error("No confirmed result");
            recovery.result = { state: saved.state, event: last };
            for (const event of saved.events) send({ type: "runtime.event", requestId: frame.requestId, event });
          } catch (error) {
            if (!recovery.controller.signal.aborted) {
              console.error("Runtime recovery failed; original files retained:", error);
              try { send({ type: "runtime.event", requestId: frame.requestId, event: { type: "turn.error", uncertain: true, message: "Result unavailable; files retained" } }); } catch { /* The next connection can read the same result. */ }
            }
            active.delete(frame.requestId);
          }
        })();
        return;
      }
      if (frame.input.spaceId !== options.spaceId || !options.capabilities.harnesses.includes(frame.input.harness)) throw new Error("Invalid Runtime target");
      const previous = active.get(frame.requestId);
      if (previous) {
        if (previous.sessionId !== frame.input.sessionId || previous.turnId !== frame.input.turnId || previous.harness !== frame.input.harness) throw new Error("Runtime execution identity changed");
        await previous.promise;
        const saved = await options.store.recoverResult(frame.input, frame.requestId);
        if (saved) for (const event of saved.events) send({ type: "runtime.event", requestId: frame.requestId, event });
        return;
      }
      const requestContext = async (executionSignal: AbortSignal, historyOnly = false) => {
        const signal = AbortSignal.any([executionSignal, disconnected.signal]);
        signal.throwIfAborted();
        const pendingTurnIds = await options.store.pendingTurnIds(frame.input.sessionId);
        return new Promise<RuntimeContext>((resolve, reject) => {
          const abort = () => { clearTimeout(timeout); contexts.delete(frame.requestId); signal.removeEventListener("abort", abort); reject(new Error("Runtime context request aborted")); };
          const timeout = setTimeout(abort, 60_000);
          signal.addEventListener("abort", abort, { once: true });
          contexts.set(frame.requestId, (context) => { clearTimeout(timeout); signal.removeEventListener("abort", abort); resolve(context); });
          try { send({ type: "runtime.event", requestId: frame.requestId, event: { type: "context.required", pendingTurnIds, ...(historyOnly ? { historyOnly: true } : {}) } }); }
          catch { abort(); }
          if (signal.aborted) abort();
        });
      };
      if ([...active.values()].some((entry) => entry.sessionId === frame.input.sessionId) && !frame.input.context.complete) frame.input.context = await requestContext(options.signal);
      const repeated = seen.has(frame.requestId);
      for (const [requestId, entry] of active) {
        if (entry.sessionId !== frame.input.sessionId) continue;
        const resolved = frame.input.context.resolvedTurnIds?.includes(entry.turnId);
        const settled = entry.result && frame.input.context.settledTurnIds?.includes(entry.turnId);
        if (!resolved && !settled) continue;
        entry.controller.abort();
        await entry.promise;
        active.delete(requestId);
      }
      if ([...active.values()].some((entry) => entry.sessionId === frame.input.sessionId) || active.size >= 8) {
        send({ type: "runtime.event", requestId: frame.requestId, event: { type: "turn.error", message: "Local Runtime is busy" } });
        return;
      }
      seen.add(frame.requestId);
      if (seen.size > 4096) { const oldest = seen.values().next().value; if (oldest) seen.delete(oldest); }
      const controller = new AbortController();
      const execution: Execution = { controller, sessionId: frame.input.sessionId, turnId: frame.input.turnId, harness: frame.input.harness, promise: Promise.resolve() };
      active.set(frame.requestId, execution);
      const durableEvents: RuntimeExecutionEvent[] = [];
      const emit = (value: RuntimeExecutionEvent) => {
        if (value.type === "message.commit") durableEvents.push(value);
        send({ type: "runtime.event", requestId: frame.requestId, event: value });
      };
      execution.promise = (async () => {
        try {
          const saved = await options.store.recoverResult(frame.input, frame.requestId);
          if (saved) {
            const last = saved.events.at(-1);
            if (last?.type !== "turn.end") throw new Error("Incomplete saved Runtime result");
            execution.result = { state: saved.state, event: last };
            for (const event of saved.events) emit(event);
            return;
          }
          if (frame.resumeOnly || repeated) {
            emit({ type: "turn.error", message: "Execution outcome is unknown; native files retained, no replay", uncertain: true });
            active.delete(frame.requestId);
            return;
          }
          const run = () => (frame.input.harness === "pi" ? executePi : executeCodex)(frame.input, options.harnesses, options.cwd, options.store, emit, controller.signal);
          // Preparation can request context, then fall back once from native archive to DB.
          // These retries precede started(), so they never replay model or tool work.
          for (let attempt = 0; ; attempt++) {
            try { execution.result = await run(); break; }
            catch (error) {
              if (!(error instanceof ContextRequiredError) || attempt >= 2) throw error;
              frame.input.context = await requestContext(controller.signal, error.historyOnly);
            }
          }
          await options.store.recordResult(execution.result.state, frame.requestId, [...durableEvents, execution.result.event]);
          emit(execution.result.event);
        } catch (error) {
          try { emit({ type: "turn.error", message: error instanceof Error ? error.message : String(error), uncertain: !!execution.result || frame.resumeOnly === true || error instanceof ProcessCleanupUncertainError }); } catch { /* Native files remain for recovery. */ }
          active.delete(frame.requestId);
        }
      })();
    })().catch((error) => { console.error("Runtime protocol error:", error); stop(); });
  });
  readyTimer = setTimeout(() => socket.close(4408, "Runtime handshake timed out"), 15_000);
  if (options.signal.aborted) stop();
  try { await closed; await Promise.allSettled([...active.values()].map((entry) => entry.promise)); }
  finally { clearTimeout(readyTimer); clearInterval(heartbeat); options.signal.removeEventListener("abort", stop); }
  return fatal ? "fatal" : conflict ? "conflict" : "retry";
}
