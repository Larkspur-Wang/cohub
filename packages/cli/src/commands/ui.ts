import { readFileSync } from "node:fs";
import {
  HttpError,
  type CohubHttpClient,
  type UiCommandRecord,
  type UiSurfaceRequest,
} from "@neta-art/cohub";
import {
  parseWorkRef,
  UI_COMMAND_DEFAULT_TIMEOUT_MS,
  UI_COMMAND_MAX_TIMEOUT_MS,
} from "@neta-art/cohub";
import type { Command } from "commander";
import { createClient } from "../client.js";
import { error, handleHttp, json as outJson, jsonRequested, ok } from "../output.js";
import { getWorkByRef } from "../work-ref.js";

const FILE_SCHEME = "file://";
const WORK_SCHEME = "work://";

type PreviewTarget =
  | { kind: "file"; path: string }
  | { kind: "work"; workId: string; label: string; launch: { search?: string; hash?: string } };

function optionalSpaceId(command: Command): string | undefined {
  let current: Command | null = command;
  while (current) {
    const opts = current.opts() as Record<string, unknown>;
    if (typeof opts.space === "string" && opts.space.trim()) return opts.space.trim();
    current = current.parent ?? null;
  }
  return process.env.COHUB_SPACE_ID?.trim() || undefined;
}

function parseFilePath(value: string): string {
  const path = value.slice(FILE_SCHEME.length).trim();
  if (
    !path ||
    path.startsWith("/") ||
    path.includes("\0") ||
    path.split("/").some((segment) => segment === "..") ||
    path.includes("\\")
  ) {
    return error("Invalid file path", "Use a relative Space path after file://.");
  }
  return path;
}

function hasFileScheme(value: string): boolean {
  return value.toLowerCase().startsWith(FILE_SCHEME);
}

function hasWorkScheme(value: string): boolean {
  return value.toLowerCase().startsWith(WORK_SCHEME);
}

type PreviewOptions = {
  call?: string;
  data?: string;
  input?: string;
  client?: string;
  commandId?: string;
  timeoutMs?: string;
  noWait?: boolean;
  json?: boolean;
};

function readCallInput(opts: PreviewOptions): unknown {
  if (opts.data !== undefined && opts.input !== undefined) {
    return error("Conflicting input", "Use either --data or --input, not both.");
  }
  const raw =
    opts.data !== undefined
      ? opts.data
      : opts.input !== undefined
        ? opts.input === "-"
          ? readFileSync(0, "utf-8")
          : readFileSync(opts.input, "utf-8")
        : undefined;
  if (raw === undefined) return undefined;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return error("Invalid input", "Call input must be valid JSON.");
  }
}

function parseTimeout(value: string | undefined): number {
  if (!value) return UI_COMMAND_DEFAULT_TIMEOUT_MS;
  const parsed = Math.floor(Number(value));
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > UI_COMMAND_MAX_TIMEOUT_MS) {
    return error(
      "Invalid timeout",
      `--timeout-ms must be between 1 and ${UI_COMMAND_MAX_TIMEOUT_MS} milliseconds.`,
    );
  }
  return parsed;
}

async function resolveWorkTarget(client: CohubHttpClient, ref: string): Promise<PreviewTarget> {
  const normalized = hasWorkScheme(ref) ? ref.slice(WORK_SCHEME.length) : ref;
  const parsed = parseWorkRef(normalized);
  const detail = await getWorkByRef(client, normalized);
  return {
    kind: "work",
    workId: detail.work.id,
    label: detail.work.slug,
    launch: {
      ...(parsed.search ? { search: parsed.search } : {}),
      ...(parsed.hash ? { hash: parsed.hash } : {}),
    },
  };
}

async function resolvePreviewTarget(
  client: CohubHttpClient,
  command: Command,
  value: string,
): Promise<PreviewTarget> {
  if (hasFileScheme(value)) return { kind: "file", path: parseFilePath(value) };
  if (hasWorkScheme(value)) return resolveWorkTarget(client, value);

  const spaceId = optionalSpaceId(command);
  if (spaceId) {
    try {
      await client.space(spaceId).files.read(value);
      return { kind: "file", path: value };
    } catch (cause: unknown) {
      if (!(cause instanceof HttpError) || cause.status !== 404) throw cause;
    }
  }
  return resolveWorkTarget(client, value);
}

function reportDispatch(record: UiCommandRecord): void {
  if (record.status !== "pending") {
    reportOutcome(record, Boolean(record.command.request));
    return;
  }
  ok(`UI command dispatched (${record.commandId})`);
}

function reportOutcome(record: UiCommandRecord, called: boolean): void {
  if (record.status === "applied") {
    ok(called ? "Work preview shown and method called" : "Preview shown");
    if (record.result !== undefined) {
      console.log(typeof record.result === "string" ? record.result : JSON.stringify(record.result, null, 2));
    }
    return;
  }
  error(
    `UI command ${record.status}`,
    record.error?.message ?? "The Cohub frontend did not apply this command.",
  );
}

export function registerUi(program: Command): void {
  const ui = program
    .command("ui")
    .description("Drive the Cohub frontend that started this work")
    .addHelpText(
      "after",
      `
Commands reach only the frontend instance that originated the current chat,
resolved from request provenance. Nothing else can be targeted.

Examples:
  cohub ui preview <work-or-file>
  cohub ui preview file://src/main.ts
  cohub ui preview work://alice/studio/launch
  cohub ui preview alice/studio/launch
  cohub ui preview https://cohub.live/alice/studio/w/launch?view=timeline
  cohub ui preview <work-id> --call selection.get
  cohub ui preview <work-id> --call board.focus --data '{"nodeId":"n1"}'
`,
    );

  const preview = ui
    .command("preview <work-or-file>")
    .description("Show a file or Work preview tab, optionally calling a Work method")
    .option("--call <method>", "Method the Work registered via client.work.surface.handle()")
    .option("--data <json>", "Inline JSON input for --call")
    .option("-i, --input <file>", "JSON input file for --call; use - for stdin")
    .option("--client <clientId>", "Target a specific frontend instance of your account")
    .option("--command-id <id>", "Stable id so retries never dispatch twice")
    .option("--no-wait", "Dispatch the command and exit without waiting for a result")
    .option(
      "--timeout-ms <ms>",
      `How long to wait for the frontend (default: ${UI_COMMAND_DEFAULT_TIMEOUT_MS}; max: ${UI_COMMAND_MAX_TIMEOUT_MS})`,
    )
    .option("--json", "Output as JSON")
    .action(async (work: string, opts: PreviewOptions) => {
      const callInput = opts.call ? readCallInput(opts) : undefined;
      if (!opts.call && (opts.data !== undefined || opts.input !== undefined)) {
        return error("Missing --call", "--data and --input only apply together with --call.");
      }
      if (opts.noWait && opts.timeoutMs !== undefined) {
        return error("Conflicting wait options", "Use either --no-wait or --timeout-ms, not both.");
      }
      const timeoutMs = parseTimeout(opts.timeoutMs);
      const client = createClient();
      try {
        const target = await resolvePreviewTarget(client, preview, work);
        if (target.kind === "file" && opts.call) {
          return error("Unsupported option", "--call only applies to Work previews.");
        }
        const request: UiSurfaceRequest | undefined = opts.call
          ? { method: opts.call, ...(callInput === undefined ? {} : { input: callInput }) }
          : undefined;

        const input = {
          command: {
            type: "preview.show" as const,
            preview:
              target.kind === "file"
                ? target
                : {
                    kind: "work" as const,
                    workId: target.workId,
                    label: target.label,
                    ...(target.launch.search || target.launch.hash ? { launch: target.launch } : {}),
                  },
            ...(request ? { request } : {}),
          },
          ...(opts.client ? { targetClientId: opts.client } : {}),
          ...(opts.commandId ? { commandId: opts.commandId } : {}),
        };
        const record = opts.noWait
          ? (await client.ui.create(input)).command
          : await client.ui.run(input, { timeoutMs });

        if (jsonRequested(opts)) return outJson(record);
        if (opts.noWait) return reportDispatch(record);
        reportOutcome(record, Boolean(request));
      } catch (e: unknown) {
        if (e instanceof Error && e.name === "WorkRefParseError") return error(e.message);
        handleHttp(e);
      }
    });

  preview.addHelpText(
    "after",
    `
Notes:
  - Use file:// and work:// to make the target explicit.
  - A plain target checks the current Space for a file before resolving a Work.
  - Showing a preview is idempotent; repeating it re-activates the same tab.
  - --call waits for the Work to announce readiness, then invokes the method.
  - Which methods exist is up to the Work author.
`,
  );
}
