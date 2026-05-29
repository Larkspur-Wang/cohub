import { randomUUID } from "node:crypto";
import type { Job } from "bullmq";
import { getAgentTracer, wrapToolCall } from "@cohub/infra/tracing/agent";
import {
  buildRunCommandToolContent,
  buildRunCommandRunningProgress,
  type RunCommandTermination,
  RUN_COMMAND_TIMEOUT_SECONDS,
  RUN_COMMAND_TOOL_NAME,
} from "@cohub/core/commands";
import type { AgentRunCommandJobResult } from "./queue.js";
import { createSandboxCodingTools } from "./sandbox/tools.js";
import { runWithToolExecutionContext } from "./tool-context.js";
import { logger } from "./logger.js";
import type { AgentRunCommandJobData } from "./queue.js";

const tools = createSandboxCodingTools();
const tracer = getAgentTracer();

function extractToolResultText(result: unknown) {
  if (!result || typeof result !== "object") return "";
  const content = (result as { content?: unknown }).content;
  if (!Array.isArray(content)) return typeof content === "string" ? content : "";
  return content
    .map((item) => item && typeof item === "object" && (item as { type?: unknown }).type === "text"
      ? String((item as { text?: unknown }).text ?? "")
      : "")
    .join("");
}

function getExitCode(result: unknown) {
  if (!result || typeof result !== "object") return null;
  const details = (result as { details?: unknown }).details;
  if (!details || typeof details !== "object") return null;
  const exitCode = (details as { exitCode?: unknown }).exitCode;
  return typeof exitCode === "number" ? exitCode : null;
}

function getTermination(result: unknown): RunCommandTermination | null {
  if (!result || typeof result !== "object") return null;
  const details = (result as { details?: unknown }).details;
  if (!details || typeof details !== "object") return null;
  const termination = (details as { termination?: unknown }).termination;
  if (!termination || typeof termination !== "object" || Array.isArray(termination)) return null;
  const reason = (termination as { reason?: unknown }).reason;
  if (reason !== "exited" && reason !== "timed_out" && reason !== "aborted") return null;
  const exitCode = (termination as { exitCode?: unknown }).exitCode;
  const timeoutSecs = (termination as { timeoutSecs?: unknown }).timeoutSecs;
  const message = (termination as { message?: unknown }).message;
  return {
    reason: reason as RunCommandTermination["reason"],
    exitCode: typeof exitCode === "number" ? exitCode : null,
    ...(typeof timeoutSecs === "number" ? { timeoutSecs } : {}),
    ...(typeof message === "string" ? { message } : {}),
  };
}

function getOutputTruncation(result: unknown) {
  if (!result || typeof result !== "object") return false;
  const details = (result as { details?: unknown }).details;
  if (!details || typeof details !== "object") return false;
  return Boolean((details as { truncation?: unknown }).truncation);
}

function getFailureDetails(result: unknown) {
  if (!result || typeof result !== "object") return null;
  const details = (result as { details?: unknown }).details;
  if (!details || typeof details !== "object" || Array.isArray(details)) return null;
  return (details as { isError?: unknown }).isError === true ? (details as Record<string, unknown>) : null;
}

export async function processRunCommandJob(job: Job<AgentRunCommandJobData>): Promise<AgentRunCommandJobResult> {
  const data = job.data;
  if (!data.spaceId || !data.taskRunId || !data.command || !data.cwd) {
    throw new Error("Invalid run_command job payload");
  }

  const bashTool = tools.find((tool) => tool.name === "bash");
  if (!bashTool) throw new Error("bash tool is not available");

  const toolCallId = `run_command_${randomUUID()}`;
  let latestOutput = "";
  let lastProgressAt = 0;
  let lastProgressSignature = "";

  const startAt = Date.now();
  const pushProgress = async (phase: "queued" | "running", done = false, exitCode: number | null = null, durationMs = 0, termination?: RunCommandTermination | null): Promise<void> => {
    const progress = done
      ? {
          kind: "run_command" as const,
          phase,
          content: buildRunCommandToolContent({
            toolCallId,
            command: data.command,
            cwd: data.cwd,
            output: latestOutput,
            status: "done",
            exitCode,
            termination,
            durationMs,
          }),
        }
      : buildRunCommandRunningProgress({
          toolCallId,
          command: data.command,
          cwd: data.cwd,
          output: latestOutput,
        });
    const signature = JSON.stringify(progress);
    const now = Date.now();
    if (!done && signature === lastProgressSignature && now - lastProgressAt < 750) return;
    lastProgressSignature = signature;
    lastProgressAt = now;
    await job.updateProgress(progress);
  };

  return runWithToolExecutionContext({
    spaceId: data.spaceId,
    sessionId: data.spaceId,
    llmRound: 0,
    toolCallId,
    requestId: data.requestId ?? undefined,
  }, async () => wrapToolCall(tracer, {
    toolName: RUN_COMMAND_TOOL_NAME,
    input: { command: data.command, cwd: data.cwd, taskRunId: data.taskRunId },
    spaceId: data.spaceId,
    sessionId: data.taskRunId,
    llmRound: 0,
    toolCallId,
    requestId: data.requestId ?? undefined,
  }, async () => {
    await pushProgress("queued");
    try {
      const result = await bashTool.execute(
        toolCallId,
        { command: data.command, timeout: RUN_COMMAND_TIMEOUT_SECONDS } as never,
        undefined,
        (partial: unknown) => {
          const text = extractToolResultText(partial);
          if (text) latestOutput = text;
          void pushProgress("running");
        },
      );
      const failure = getFailureDetails(result);
      if (failure) {
        throw new Error(typeof failure.message === "string" ? failure.message : "Command infrastructure failure");
      }
      latestOutput = extractToolResultText(result) || latestOutput;
      const exitCode = getExitCode(result);
      const termination = getTermination(result) ?? { reason: "exited" as const, exitCode };
      const truncated = getOutputTruncation(result);
      const durationMs = Date.now() - startAt;
      const content = buildRunCommandToolContent({
        toolCallId,
        command: data.command,
        cwd: data.cwd,
        output: latestOutput,
        status: "done",
        exitCode,
        termination,
        durationMs,
      });
      await pushProgress("running", true, exitCode, durationMs, termination);
      return {
        ok: true,
        exitCode,
        termination,
        durationMs,
        output: latestOutput,
        truncated,
        content,
      } satisfies AgentRunCommandJobResult;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.warn(`[RunCommand] infrastructure failure spaceId=${data.spaceId} taskRunId=${data.taskRunId}: ${errorMessage}`);
      throw error;
    }
  }));
}
