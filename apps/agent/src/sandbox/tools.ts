import { randomUUID } from "node:crypto";
import { join, relative } from "node:path";
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
import { env } from "../env.js";
import { getCurrentToolExecutionContext } from "../tool-context.js";
import { type SandboxConnection, waitForSandboxConnection } from "./ws-client.js";

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

function toSandboxPath(absolutePath: string) {
  const relativePath = relative(getSpaceWorkspaceDir(getCurrentSpaceId()), absolutePath);
  if (!relativePath || relativePath === "") return ".";
  return relativePath;
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
      const result = await rpc(connection, "fs.read", { path: toSandboxPath(absolutePath) });
      return Buffer.from(result.content, "utf8");
    },
    async access(absolutePath) {
      const connection = await getCurrentConnection();
      await rpc(connection, "fs.read", { path: toSandboxPath(absolutePath), offset: 1, limit: 1 });
    },
  };
}

function createRemoteWriteOperations(): WriteOperations {
  return {
    async writeFile(absolutePath, content) {
      const connection = await getCurrentConnection();
      await rpc(connection, "fs.write", { path: toSandboxPath(absolutePath), content });
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

        const finish = (fn: () => void) => {
          if (settled) return;
          settled = true;
          fn();
        };

        void (async () => {
          try {
            const connection = await getCurrentConnection();

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
                cwd: toSandboxPath(cwd),
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
                    finish(() => resolve({ exitCode: event.exitCode ?? null }));
                  }
                },
              },
            );
          } catch (error) {
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
      const result = await rpc(connection, "fs.stat", { path: toSandboxPath(absolutePath) });
      return result.exists;
    },
    async stat(absolutePath) {
      const connection = await getCurrentConnection();
      const result = await rpc(connection, "fs.stat", { path: toSandboxPath(absolutePath) });
      return {
        isDirectory: () => result.isDirectory,
      };
    },
    async readdir(absolutePath) {
      const connection = await getCurrentConnection();
      const result = await rpc(connection, "fs.ls", { path: toSandboxPath(absolutePath) });
      return result.entries.map((entry) => entry.endsWith("/") ? entry.slice(0, -1) : entry);
    },
  };
}

function createRemoteFindOperations(): FindOperations {
  return {
    async exists(absolutePath) {
      const connection = await getCurrentConnection();
      const result = await rpc(connection, "fs.stat", { path: toSandboxPath(absolutePath) });
      return result.exists;
    },
    async glob(pattern, cwd, options) {
      const connection = await getCurrentConnection();
      const result = await rpc(connection, "fs.find", {
        pattern,
        path: toSandboxPath(cwd),
        limit: options.limit,
      });
      return result.matches;
    },
  };
}

function createRemoteGrepTool() {
  return createGrepTool(env.WORKSPACE_ROOT, {
    operations: {
      async isDirectory(absolutePath: string) {
        const connection = await getCurrentConnection();
        const result = await rpc(connection, "fs.stat", { path: toSandboxPath(absolutePath) });
        return result.isDirectory;
      },
      async readFile(absolutePath: string) {
        const connection = await getCurrentConnection();
        const result = await rpc(connection, "fs.read", { path: toSandboxPath(absolutePath) });
        return result.content;
      },
    },
    // kept only for type compatibility through operations; execution uses custom tool below
  } as never);
}

export function createSandboxCodingTools() {
  const toolCwd = env.WORKSPACE_ROOT;
  const grepTool = createRemoteGrepTool();
  grepTool.execute = async (_toolCallId, input) => {
    const connection = await getCurrentConnection();
    const result = await rpc(connection, "fs.grep", {
      pattern: input.pattern,
      path: input.path,
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
