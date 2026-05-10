import { Type, type Static } from "@mariozechner/pi-ai";
import type { AgentTool, AgentToolResult, AgentToolUpdateCallback } from "@mariozechner/pi-agent-core";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, formatSize, truncateHead } from "./truncate.js";

export interface ReadOperations {
  readFile: (absolutePath: string) => Promise<Buffer>;
  access: (absolutePath: string) => Promise<void>;
  detectImageMimeType?: (absolutePath: string) => Promise<string | null | undefined>;
}

export interface WriteOperations {
  writeFile: (absolutePath: string, content: string) => Promise<void>;
  mkdir: (dir: string) => Promise<void>;
}

export interface EditOperations {
  readFile: (absolutePath: string) => Promise<Buffer>;
  writeFile: (absolutePath: string, content: string) => Promise<void>;
  access: (absolutePath: string) => Promise<void>;
}

export interface BashOperations {
  exec: (
    command: string,
    cwd: string,
    options: { onData: (chunk: Buffer) => void; signal?: AbortSignal; timeout?: number; env?: Record<string, string> },
  ) => Promise<{ exitCode: number | null }>;
}

function tailOutput(content: string, maxChars = 900) {
  if (content.length <= maxChars) return content;
  return `…${content.slice(-maxChars)}`;
}

function createThrottledToolUpdate(onUpdate?: AgentToolUpdateCallback<unknown>) {
  let lastSentAt = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pendingText = "";

  const emit = () => {
    if (!onUpdate || !pendingText) return;
    lastSentAt = Date.now();
    onUpdate({
      content: [{ type: "text", text: tailOutput(pendingText) }],
      details: { partial: true },
    });
  };

  return {
    push(text: string) {
      pendingText = text;
      if (!onUpdate) return;
      const elapsed = Date.now() - lastSentAt;
      if (elapsed >= 250) {
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        emit();
        return;
      }
      if (!timer) {
        timer = setTimeout(() => {
          timer = null;
          emit();
        }, 250 - elapsed);
      }
    },
    flush() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      emit();
    },
  };
}

export interface LsOperations {
  exists: (absolutePath: string) => Promise<boolean>;
  stat: (absolutePath: string) => Promise<{ isDirectory: () => boolean }>;
  readdir: (absolutePath: string) => Promise<string[]>;
}

export interface FindOperations {
  exists: (absolutePath: string) => Promise<boolean>;
  glob: (pattern: string, cwd: string, options: { limit: number; ignore?: string[] }) => Promise<string[]>;
}

export type GrepToolInput = {
  pattern: string;
  path?: string;
  glob?: string;
  ignoreCase?: boolean;
  literal?: boolean;
  context?: number;
  limit?: number;
};

export type GrepToolDetails = {
  truncation?: unknown;
  matchLimitReached?: number;
  linesTruncated?: boolean;
};

function resolveToCwd(path: string, cwd: string): string {
  if (path.startsWith("/")) return path;
  if (path === ".") return cwd;
  return `${cwd.replace(/\/$/, "")}/${path}`;
}

export function createReadTool(cwd: string, options: { operations: ReadOperations }): AgentTool {
  const parameters = Type.Object({
    path: Type.String({ description: "Path to the file to read (relative or absolute)" }),
    offset: Type.Optional(Type.Number({ description: "Line number to start reading from (1-indexed)" })),
    limit: Type.Optional(Type.Number({ description: "Maximum number of lines to read" })),
  });
  return {
    name: "read",
    label: "read",
    description: `Read the contents of a file. Supports text files and images (jpg, png, gif, webp). Images are sent as attachments. For text files, output is truncated to ${DEFAULT_MAX_LINES} lines or ${DEFAULT_MAX_BYTES / 1024}KB (whichever is hit first). Use offset/limit for large files. When you need the full file, continue with offset until complete.`,
    parameters,
    async execute(_toolCallId, rawParams): Promise<AgentToolResult<unknown>> {
      const params = rawParams as Static<typeof parameters>;
      const absolutePath = resolveToCwd(params.path, cwd);
      await options.operations.access(absolutePath);
      const mimeType = options.operations.detectImageMimeType ? await options.operations.detectImageMimeType(absolutePath) : null;
      if (mimeType) {
        const buffer = await options.operations.readFile(absolutePath);
        return {
          content: [
            { type: "text", text: `Read image file [${mimeType}]` },
            { type: "image", data: buffer.toString("base64"), mimeType },
          ],
          details: undefined,
        };
      }
      const buffer = await options.operations.readFile(absolutePath);
      const allLines = buffer.toString("utf-8").split("\n");
      const startLine = params.offset ? Math.max(0, params.offset - 1) : 0;
      if (startLine >= allLines.length) {
        throw new Error(`Offset ${params.offset} is beyond end of file (${allLines.length} lines total)`);
      }
      const selected = params.limit !== undefined
        ? allLines.slice(startLine, Math.min(startLine + params.limit, allLines.length)).join("\n")
        : allLines.slice(startLine).join("\n");
      const truncation = truncateHead(selected);
      let output = truncation.content;
      if (truncation.firstLineExceedsLimit) {
        output = `[Line ${startLine + 1} exceeds ${formatSize(DEFAULT_MAX_BYTES)} limit]`;
      } else if (truncation.truncated) {
        const endLineDisplay = startLine + truncation.outputLines;
        output += `\n\n[Showing lines ${startLine + 1}-${endLineDisplay} of ${allLines.length}. Use offset=${endLineDisplay + 1} to continue.]`;
      } else if (params.limit !== undefined && startLine + params.limit < allLines.length) {
        output += `\n\n[${allLines.length - (startLine + params.limit)} more lines in file. Use offset=${startLine + params.limit + 1} to continue.]`;
      }
      return {
        content: [{ type: "text", text: output }],
        details: truncation.truncated ? { truncation } : undefined,
      };
    },
  };
}

export function createWriteTool(cwd: string, options: { operations: WriteOperations }): AgentTool {
  const parameters = Type.Object({
    path: Type.String({ description: "Path to the file to write (relative or absolute)" }),
    content: Type.String({ description: "Content to write to the file" }),
  });
  return {
    name: "write",
    label: "write",
    description: "Write content to a file. Creates the file if it doesn't exist, overwrites if it does. Automatically creates parent directories.",
    parameters,
    async execute(_toolCallId, rawParams) {
      const params = rawParams as Static<typeof parameters>;
      const absolutePath = resolveToCwd(params.path, cwd);
      const dir = absolutePath.slice(0, absolutePath.lastIndexOf("/")) || "/";
      await options.operations.mkdir(dir);
      await options.operations.writeFile(absolutePath, params.content);
      return {
        content: [{ type: "text", text: `Successfully wrote ${params.content.length} bytes to ${params.path}` }],
        details: undefined,
      };
    },
  };
}

export function createEditTool(cwd: string, options: { operations: EditOperations }): AgentTool {
  const parameters = Type.Object({
    path: Type.String({ description: "Path to the file to edit (relative or absolute)" }),
    edits: Type.Array(Type.Object({
      oldText: Type.String({ description: "Exact text for one targeted replacement. It must match a unique region in the original file." }),
      newText: Type.String({ description: "Replacement text for this targeted edit." }),
    }), { description: "One or more targeted replacements." }),
  });
  return {
    name: "edit",
    label: "edit",
    description: "Edit a file by applying exact text replacements.",
    parameters,
    async execute(_toolCallId, rawParams) {
      const params = rawParams as Static<typeof parameters>;
      const absolutePath = resolveToCwd(params.path, cwd);
      await options.operations.access(absolutePath);
      let content = (await options.operations.readFile(absolutePath)).toString("utf-8");
      for (const edit of params.edits) {
        const occurrences = content.split(edit.oldText).length - 1;
        if (occurrences !== 1) {
          throw new Error(`oldText must match exactly one region in ${params.path}, found ${occurrences}`);
        }
        content = content.replace(edit.oldText, edit.newText);
      }
      await options.operations.writeFile(absolutePath, content);
      return {
        content: [{ type: "text", text: `Applied ${params.edits.length} edit(s) to ${params.path}` }],
        details: undefined,
      };
    },
  };
}

export function createBashTool(cwd: string, options: { operations: BashOperations }): AgentTool {
  const parameters = Type.Object({
    command: Type.String({ description: "Bash command to execute" }),
    timeout: Type.Optional(Type.Number({ description: "Timeout in seconds (optional, no default timeout)" })),
  });
  return {
    name: "bash",
    label: "bash",
    description: "Execute a bash command in the current working directory. Returns stdout and stderr. Output is truncated to last 2000 lines or 50KB.",
    parameters,
    async execute(_toolCallId, rawParams, signal, onUpdate) {
      const params = rawParams as Static<typeof parameters>;
      const chunks: Buffer[] = [];
      let outputPreview = "";
      const updates = createThrottledToolUpdate(onUpdate);
      const result = await options.operations.exec(params.command, cwd, {
        onData: (chunk) => {
          chunks.push(chunk);
          outputPreview = tailOutput(`${outputPreview}${chunk.toString("utf-8")}`);
          updates.push(outputPreview);
        },
        signal,
        timeout: params.timeout,
      });
      updates.flush();
      const output = Buffer.concat(chunks).toString("utf-8");
      const truncated = truncateHead(output, { maxLines: DEFAULT_MAX_LINES, maxBytes: DEFAULT_MAX_BYTES });
      return {
        content: [{ type: "text", text: truncated.truncated ? truncated.content : output }],
        details: { exitCode: result.exitCode, truncation: truncated.truncated ? truncated : undefined },
      };
    },
  };
}

export function createLsTool(cwd: string, options: { operations: LsOperations }): AgentTool {
  const parameters = Type.Object({
    path: Type.String({ description: "Directory to list (default: current directory)" }),
    limit: Type.Optional(Type.Number({ description: "Maximum number of entries to return (default: 500)" })),
  });
  return {
    name: "ls",
    label: "ls",
    description: "List directory contents. Returns entries sorted alphabetically, with '/' suffix for directories.",
    parameters,
    async execute(_toolCallId, rawParams) {
      const params = rawParams as Static<typeof parameters>;
      const absolutePath = resolveToCwd(params.path || ".", cwd);
      const entries = await options.operations.readdir(absolutePath);
      return {
        content: [{ type: "text", text: entries.slice(0, params.limit ?? 500).join("\n") }],
        details: undefined,
      };
    },
  };
}

export function createFindTool(cwd: string, options: { operations: FindOperations }): AgentTool {
  const parameters = Type.Object({
    path: Type.String({ description: "Directory to search in (default: current directory)" }),
    pattern: Type.String({ description: "Glob pattern to match files" }),
    limit: Type.Optional(Type.Number({ description: "Maximum number of results" })),
  });
  return {
    name: "find",
    label: "find",
    description: "Search for files by glob pattern. Respects .gitignore.",
    parameters,
    async execute(_toolCallId, rawParams) {
      const params = rawParams as Static<typeof parameters>;
      const absolutePath = resolveToCwd(params.path || ".", cwd);
      const matches = await options.operations.glob(params.pattern, absolutePath, { limit: params.limit ?? 1000 });
      return {
        content: [{ type: "text", text: matches.join("\n") }],
        details: undefined,
      };
    },
  };
}

export function createGrepToolDefinition(cwd: string): AgentTool {
  const parameters = Type.Object({
    pattern: Type.String({ description: "Search pattern" }),
    path: Type.Optional(Type.String({ description: "Directory or file to search" })),
    glob: Type.Optional(Type.String({ description: "File glob filter" })),
    ignoreCase: Type.Optional(Type.Boolean({ description: "Case-insensitive search" })),
    literal: Type.Optional(Type.Boolean({ description: "Treat pattern as literal string" })),
    context: Type.Optional(Type.Number({ description: "Context lines" })),
    limit: Type.Optional(Type.Number({ description: "Maximum number of matches" })),
  });
  return {
    name: "grep",
    label: "grep",
    description: "Search file contents for a pattern. Respects .gitignore.",
    parameters,
    async execute() {
      return { content: [{ type: "text", text: `grep not implemented for ${cwd} without override` }], details: undefined };
    },
  };
}
