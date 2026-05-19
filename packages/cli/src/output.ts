import process from "node:process";

// -- Table rendering ---------------------------------------------------------

export type Row = Record<string, unknown>;

function colWidth(rows: Row[], key: string, label: string): number {
  const maxVal = rows.reduce((m, r) => {
    const v = r[key] ?? "";
    const s = typeof v === "object" ? JSON.stringify(v) : String(v);
    return Math.max(m, s.length);
  }, 0);
  return Math.max(label.length, maxVal) + 2;
}

export function table(rows: Row[], columns: { key: string; label: string }[]): void {
  if (rows.length === 0) {
    console.log("  (empty)");
    return;
  }

  const widths = columns.map((c) => colWidth(rows, c.key, c.label));

  const header = columns
    .map((c, i) => c.label.padEnd(widths[i] ?? 0))
    .join(" │ ")
    .trimEnd();

  console.log(header);
  console.log("─".repeat(header.length));

  for (const row of rows) {
    const line = columns
      .map((c, i) => {
        const v = row[c.key] ?? "";
        const s = typeof v === "object" ? JSON.stringify(v) : String(v);
        return s.padEnd(widths[i] ?? 0);
      })
      .join(" │ ")
      .trimEnd();
    console.log(line);
  }
}

// -- Output helpers ----------------------------------------------------------

export function json(data: unknown): void {
  console.log(JSON.stringify(data, null, 2));
}

export function ok(msg: string): void {
  console.log(`\n  ✓ ${msg}\n`);
}

export function error(msg: string, detail?: string): never {
  process.stderr.write(`\n  ✗ ${msg}\n`);
  if (detail) process.stderr.write(`    ${detail}\n`);
  process.stderr.write("\n");
  process.exit(1);
}

// -- HTTP error handler ------------------------------------------------------

function errorMessageFromBody(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const errorBody = body as { message?: unknown; error?: { message?: unknown } };
  if (typeof errorBody.message === "string" && errorBody.message.trim()) return errorBody.message;
  if (typeof errorBody.error?.message === "string" && errorBody.error.message.trim()) return errorBody.error.message;
  return null;
}

function debugErrorMetaFromBody(body: unknown): string[] {
  if (!body || typeof body !== "object") return [];
  const errorBody = body as {
    code?: unknown;
    requestId?: unknown;
    traceId?: unknown;
    error?: { code?: unknown };
  };
  const items: string[] = [];
  const code = typeof errorBody.code === "string" ? errorBody.code : typeof errorBody.error?.code === "string" ? errorBody.error.code : null;
  if (code) items.push(code);
  if (typeof errorBody.requestId === "string") items.push(`requestId: ${errorBody.requestId}`);
  if (typeof errorBody.traceId === "string") items.push(`traceId: ${errorBody.traceId}`);
  return items;
}

export function handleHttp(e: unknown): never {
  if (e instanceof Error && e.name === "AuthRequiredError") {
    return error("not authenticated", "run `cohub auth login`");
  }

  const status = (e as { status?: number }).status;
  const body = (e as { body?: unknown }).body;
  const message = errorMessageFromBody(body) ?? (e instanceof Error ? e.message : String(e));

  const detailParts: string[] = [];
  if (process.env.COHUB_DEBUG_ERRORS) {
    if (status) detailParts.push(`HTTP ${status}`);
    detailParts.push(...debugErrorMetaFromBody(body));
  }

  error(message, detailParts.length > 0 ? detailParts.join(" · ") : undefined);
}

// -- Spinner -----------------------------------------------------------------

export function spinner(): { start(msg: string): void; stop(msg: string): void } {
  let interval: ReturnType<typeof setInterval> | null = null;
  const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  let i = 0;

  return {
    start(msg: string) {
      if (process.env.CI || !process.stderr.isTTY) {
        process.stderr.write(`  ${msg}...\n`);
        return;
      }
      process.stderr.write(`  ${msg}  `);
      interval = setInterval(() => {
        process.stderr.clearLine?.(0);
        process.stderr.cursorTo?.(0);
        process.stderr.write(`  ${frames[i++ % frames.length] ?? ""} ${msg}  `);
      }, 80);
    },
    stop(msg: string) {
      if (interval) clearInterval(interval);
      if (process.env.CI || !process.stderr.isTTY) {
        process.stderr.write(`  ${msg}\n`);
        return;
      }
      process.stderr.clearLine?.(0);
      process.stderr.cursorTo?.(0);
      process.stderr.write(`  ✓ ${msg}\n`);
    },
  };
}
