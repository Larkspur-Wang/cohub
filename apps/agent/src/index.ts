import { spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import { Redis } from "ioredis";

// 从环境变量读取配置
const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
const SESSION_ID = process.env.SESSION_ID || "dev-session-001";
const WORKSPACE_DIR = process.env.WORKSPACE_DIR || "/workspace";

// 初始化 Redis 客户端
const redis = new Redis(REDIS_URL);
const pubClient = redis.duplicate();
const subClient = redis.duplicate();

const STREAM_KEY_IN = `session:${SESSION_ID}:in`;   // 后端 -> Sandbox 的指令流
const STREAM_KEY_OUT = `session:${SESSION_ID}:out`; // Sandbox -> 后端的输出流

console.log(`[Supervisor] Starting for Session: ${SESSION_ID}`);
console.log(`[Supervisor] Workspace: ${WORKSPACE_DIR}`);

/**
 * 将输出写回 Redis Stream
 */
async function sendOutput(type: string, data: any) {
  try {
    const payload = typeof data === "string" ? data : JSON.stringify(data);
    await pubClient.xadd(
      STREAM_KEY_OUT,
      "*",
      "type", type,
      "data", payload,
      "timestamp", Date.now().toString()
    );
  } catch (err) {
    console.error("[Supervisor] Failed to send output to Redis:", err);
  }
}

/**
 * 启动 Pi Agent 的 RPC 模式
 */
function startAgent() {
  sendOutput("system", "Starting Pi Agent in RPC mode...");

  const agentProcess = spawn("pi", ["--mode", "rpc", "--no-session"], {
    cwd: WORKSPACE_DIR,
    env: { ...process.env }, 
    stdio: ["pipe", "pipe", "pipe"],
  });

  // 处理 stdout 的 JSONL 流
  const stdoutDecoder = new StringDecoder("utf8");
  let stdoutBuffer = "";

  agentProcess.stdout.on("data", (chunk: Buffer) => {
    stdoutBuffer += stdoutDecoder.write(chunk);
    while (true) {
      const newlineIndex = stdoutBuffer.indexOf("\n");
      if (newlineIndex === -1) break;

      let line = stdoutBuffer.slice(0, newlineIndex);
      stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
      if (line.endsWith("\r")) line = line.slice(0, -1);

      if (line.trim()) {
        try {
          const event = JSON.parse(line);
          // 如果想在本地看到，可以直接打印
          // console.log("[Agent Event]", event.type);
          sendOutput(event.type || "agent_event", line);
        } catch (e) {
          console.error("[Supervisor] JSON Parse Error on stdout:", e);
        }
      }
    }
  });

  // 处理 stderr (通常是报错)
  agentProcess.stderr.on("data", (chunk: Buffer) => {
    const text = chunk.toString("utf-8");
    console.error("[Agent Error]", text);
    sendOutput("stderr", text);
  });

  agentProcess.on("close", (code) => {
    const msg = `Pi Agent exited with code ${code}`;
    console.log(`[Supervisor] ${msg}`);
    sendOutput("system", msg);
  });

  return agentProcess;
}

const activeProcess = startAgent();

/**
 * 向 Agent 发送 RPC 指令
 */
function sendToAgent(command: any) {
  if (activeProcess.stdin && !activeProcess.stdin.destroyed) {
    activeProcess.stdin.write(JSON.stringify(command) + "\n");
  }
}

/**
 * 监听来自后端的 Redis Stream 指令
 */
async function listenForCommands() {
  let lastId = "$"; // 从最新的消息开始读

  while (true) {
    try {
      const result = await subClient.xread("BLOCK", 5000, "STREAMS", STREAM_KEY_IN, lastId);
      
      if (result) {
        const [stream, messages] = result[0]!;
        for (const message of messages) {
          const [id, fields] = message;
          lastId = id;

          const payload = parseRedisHash(fields);
          
          if (payload.action === "prompt") {
            console.log(`[Supervisor] Received prompt: ${payload.text}`);
            sendToAgent({ type: "prompt", message: payload.text });
          } else if (payload.action === "abort") {
            console.log(`[Supervisor] Received abort command`);
            sendToAgent({ type: "abort" });
          } else if (payload.action === "rpc") {
            // 允许后端直接发自定义 RPC 报文
            try {
              const rpcCmd = JSON.parse(payload.data!);
              sendToAgent(rpcCmd);
            } catch (e) {
              console.error("[Supervisor] Invalid RPC command payload:", payload.data);
            }
          }
        }
      }
    } catch (err) {
      console.error("[Supervisor] Error reading from stream:", err);
      await new Promise(r => setTimeout(r, 1000));
    }
  }
}

function parseRedisHash(fields: string[]): Record<string, string> {
  const obj: Record<string, string> = {};
  for (let i = 0; i < fields.length; i += 2) {
    obj[fields[i]!] = fields[i + 1]!;
  }
  return obj;
}

listenForCommands();

process.on("SIGTERM", () => {
  console.log("[Supervisor] SIGTERM received. Shutting down.");
  if (activeProcess && !activeProcess.killed) {
    activeProcess.kill("SIGTERM");
  }
  process.exit(0);
});
