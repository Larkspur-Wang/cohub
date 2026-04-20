import { randomUUID } from "node:crypto";
import { join } from "node:path";
import {
  createBashTool,
  createEditTool,
  createFindTool,
  createGrepTool,
  createLsTool,
  createReadTool,
  createWriteTool,
  type BashOperations,
  type EditOperations,
  type FindOperations,
  type GrepOperations,
  type LsOperations,
  type ReadOperations,
  type WriteOperations,
} from "@mariozechner/pi-coding-agent";
import type { RpcMethod, RpcRequestMap } from "@cohub/agent-sandbox-protocol";
import { env, PLATFORM_AGENTS_DIR, PLATFORM_ROOT } from "../env.js";
import { getCurrentToolExecutionContext } from "../tool-context.js";
import { type SandboxConnection, waitForSandboxConnection } from "./ws-client.js";

const SANDBOX_WORKSPACE_ROOT = "/workspace";
const SANDBOX_PLATFORM_AGENTS_ROOT = "/configs/platform/.agents";

function getCurrentSpaceId() {
  const ctx = getCurrentToolExecutionContext();
  if (!ctx?.spaceId) {
    throw new Error("Tool execution context is missing spaceId");
  }
  return ctx.spaceId;
}

function getSpaceWorkspaceDir(spaceId: string) {
  return join(env.WORKSPACE_ROOT, spaceId, "workspace");
}

function toPosixPath(value: string) {
  return value.replace(/\\/g, "/");
}

function mapLocalAbsolutePathToSandboxPath(absolutePath: string) {
  const normalized = toPosixPath(absolutePath);
  const workspaceRoot = toPosixPath(getSpaceWorkspaceDir(getCurrentSpaceId()));
  const platformAgentsRoot = toPosixPath(PLATFORM_AGENTS_DIR);
  const platformRoot = toPosixPath(PLATFORM_ROOT);

  if (normalized === workspaceRoot) {
    return SANDBOX_WORKSPACE_ROOT;
  }
  if (normalized.startsWith(`${workspaceRoot}/`)) {
    const relativePath = normalized.slice(workspaceRoot.length + 1);
    return `${SANDBOX_WORKSPACE_ROOT}/${relativePath}`;
  }

  if (normalized === platformAgentsRoot) {
    return SANDBOX_PLATFORM_AGENTS_ROOT;
  }
  if (normalized.startsWith(`${platformAgentsRoot}/`)) {
    const relativePath = normalized.slice(platformAgentsRoot.length + 1);
    return `${SANDBOX_PLATFORM_AGENTS_ROOT}/${relativePath}`;
  }

  if (normalized === platformRoot || normalized.startsWith(`${platformRoot}/`)) {
    throw new Error(`Platform path is not tool-visible in sandbox: ${absolutePath}`);
  }

  if (normalized.startsWith("/")) {
    return normalized;
  }

  throw new Error(`Unable to map non-absolute path into sandbox: ${absolutePath}`);
}

function mapSandboxInputPath(path: string | undefined) {
  // grep path comes directly from model input and should follow sandbox path semantics:
  // relative paths resolve from the tool cwd (/workspace by default), while absolute
  // paths are interpreted inside the sandbox as-is.
  if (!path || path.trim() === "") return ".";
  if (path === ".") return ".";
  if (path.startsWith("/")) return path;
  return path;
}

async function getCurrentConnection() {
  return waitForSandboxConnection(getCurrentSpaceId());
}

async function rpc<M extends RpcMethod>(
  connection: SandboxConnection,
  method: M,
  params: RpcRequestMap[M]["params"],
) {
  return connection.request(method, params, {
    requestId: randomUUID(),
    spaceId: getCurrentSpaceId(),
    sandboxId: connection.sandboxId,
  });
}

function createRemoteReadOperations(): ReadOperations {
  return {
    async readFile(absolutePath) {
      const connection = await getCurrentConnection();
      const path = mapLocalAbsolutePathToSandboxPath(absolutePath);
      console.log(`[Tool:read] path=${path}`);
      const result = await rpc(connection, "fs.read", { path });
      return Buffer.from(result.content, "utf8");
    },
    async access(absolutePath) {
      const connection = await getCurrentConnection();
      await rpc(connection, "fs.read", { path: mapLocalAbsolutePathToSandboxPath(absolutePath), offset: 1, limit: 1 });
    },
  };
}

function createRemoteWriteOperations(): WriteOperations {
  return {
    async writeFile(absolutePath, content) {
      const path = mapLocalAbsolutePathToSandboxPath(absolutePath);
      console.log(`[Tool:write] path=${path} bytes=${content.length}`);
      const connection = await getCurrentConnection();
      await rpc(connection, "fs.write", { path, content });
    },
    async mkdir(_dir) {
      // sandbox fs.write already creates parent directories recursively
    },
  };
}

function createRemoteEditOperations(): EditOperations {
  const readOps = createRemoteReadOperations();
  const writeOps = createRemoteWriteOperations();
  return {
    readFile: readOps.readFile,
    access: async (absolutePath) => {
      await readOps.access(absolutePath);
    },
    writeFile: writeOps.writeFile,
  };
}

function createRemoteBashOperations(): BashOperations {
  return {
    exec(command, cwd, { onData, signal, timeout }) {
      return new Promise((resolve, reject) => {
        let processId: string | null = null;
        let settled = false;
        let aborting = false;
        const cmdSummary = command.trim().slice(0, 80);

        const finish = (fn: () => void) => {
          if (settled) return;
          settled = true;
          fn();
        };

        void (async () => {
          try {
            const connection = await getCurrentConnection();
            const sandboxCwd = mapLocalAbsolutePathToSandboxPath(cwd);
            console.log(`[Tool:bash] exec cmd="${cmdSummary}" cwd=${sandboxCwd}`);

            const cleanupAbort = () => {
              signal?.removeEventListener("abort", onAbort);
            };

            const onAbort = () => {
              aborting = true;
              if (!processId) return;
              void rpc(connection, "process.abort", { processId }).catch(() => undefined);
            };

            if (signal) {
              if (signal.aborted) onAbort();
              else signal.addEventListener("abort", onAbort, { once: true });
            }

            await connection.request(
              "process.start",
              {
                command,
                timeoutSecs: timeout,
                cwd: sandboxCwd,
              },
              {
                requestId: randomUUID(),
                spaceId: getCurrentSpaceId(),
                sandboxId: connection.sandboxId,
                onStream(event) {
                  if (event.type === "started") {
                    processId = event.processId;
                    if (aborting) {
                      void rpc(connection, "process.abort", { processId: event.processId }).catch(() => undefined);
                    }
                    return;
                  }

                  if (event.type === "stdout" || event.type === "stderr") {
                    onData(Buffer.from(`${event.chunk}\n`, "utf8"));
                    return;
                  }

                  if (event.type === "exit") {
                    cleanupAbort();
                    console.log(`[Tool:bash] exit code=${event.exitCode} cmd="${cmdSummary}"`);
                    finish(() => resolve({ exitCode: event.exitCode ?? null }));
                  }
                },
              },
            );
          } catch (error) {
            console.error(`[Tool:bash] error cmd="${cmdSummary}"`, error);
            finish(() => reject(error));
          }
        })();
      });
    },
  };
}

function createRemoteLsOperations(): LsOperations {
  return {
    async exists(absolutePath) {
      const connection = await getCurrentConnection();
      const result = await rpc(connection, "fs.stat", { path: mapLocalAbsolutePathToSandboxPath(absolutePath) });
      return result.exists;
    },
    async stat(absolutePath) {
      const connection = await getCurrentConnection();
      const result = await rpc(connection, "fs.stat", { path: mapLocalAbsolutePathToSandboxPath(absolutePath) });
      return {
        isDirectory: () => result.isDirectory,
      };
    },
    async readdir(absolutePath) {
      const path = mapLocalAbsolutePathToSandboxPath(absolutePath);
      console.log(`[Tool:ls] path=${path}`);
      const connection = await getCurrentConnection();
      const result = await rpc(connection, "fs.ls", { path });
      return result.entries.map((entry) => entry.endsWith("/") ? entry.slice(0, -1) : entry);
    },
  };
}

function createRemoteFindOperations(): FindOperations {
  return {
    async exists(absolutePath) {
      const connection = await getCurrentConnection();
      const result = await rpc(connection, "fs.stat", { path: mapLocalAbsolutePathToSandboxPath(absolutePath) });
      return result.exists;
    },
    async glob(pattern, cwd, options) {
      const path = mapLocalAbsolutePathToSandboxPath(cwd);
      console.log(`[Tool:find] pattern=${pattern} path=${path}`);
      const connection = await getCurrentConnection();
      const result = await rpc(connection, "fs.find", {
        pattern,
        path,
        limit: options.limit,
      });
      return result.matches;
    },
  };
}

function createRemoteGrepTool() {
  return createGrepTool(SANDBOX_WORKSPACE_ROOT, {
    operations: {
      async isDirectory(absolutePath: string) {
        const connection = await getCurrentConnection();
        const result = await rpc(connection, "fs.stat", { path: mapLocalAbsolutePathToSandboxPath(absolutePath) });
        return result.isDirectory;
      },
      async readFile(absolutePath: string) {
        const connection = await getCurrentConnection();
        const result = await rpc(connection, "fs.read", { path: mapLocalAbsolutePathToSandboxPath(absolutePath) });
        return result.content;
      },
    },
    // kept only for type compatibility through operations; execution uses custom tool below
  } as never);
}

export function createSandboxCodingTools() {
  const toolCwd = SANDBOX_WORKSPACE_ROOT;
  const grepTool = createRemoteGrepTool();
  grepTool.execute = async (_toolCallId, input) => {
    console.log(`[Tool:grep] pattern=${input.pattern} path=${input.path}`);
    const connection = await getCurrentConnection();
    const result = await rpc(connection, "fs.grep", {
      pattern: input.pattern,
      path: mapSandboxInputPath(input.path),
      glob: input.glob,
      ignoreCase: input.ignoreCase,
      literal: input.literal,
      context: input.context,
      limit: input.limit,
    });
    return {
      content: [{ type: "text", text: result.lines.join("\n") || "No matches found" }],
      details: undefined,
    };
  };

  return [
    createReadTool(toolCwd, { operations: createRemoteReadOperations() }),
    createBashTool(toolCwd, { operations: createRemoteBashOperations() }),
    createEditTool(toolCwd, { operations: createRemoteEditOperations() }),
    createWriteTool(toolCwd, { operations: createRemoteWriteOperations() }),
    createLsTool(toolCwd, { operations: createRemoteLsOperations() }),
    createFindTool(toolCwd, { operations: createRemoteFindOperations() }),
    grepTool,
  ];
}
