import { Type } from "@mariozechner/pi-ai";
import type { AgentTool, AgentToolUpdateCallback } from "@mariozechner/pi-agent-core";
import { getCurrentToolExecutionContext, runWithToolExecutionContext } from "../../tool-context.js";

const SPACE_ID_DESCRIPTION = "Only set when querying another space by id";

type AccessCheck = (spaceId: string) => Promise<void>;

function getRequestedSpaceId(params: unknown) {
  if (!params || typeof params !== "object") return null;
  const value = (params as Record<string, unknown>).space_id;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function withoutSpaceId(input: unknown) {
  if (!input || typeof input !== "object") return input;
  const { space_id: _spaceId, ...rest } = input as Record<string, unknown>;
  return rest;
}

function routeExecute(sandboxTool: AgentTool, checkAccess: AccessCheck) {
  return async (toolCallId: string, params: unknown, signal?: AbortSignal, onUpdate?: AgentToolUpdateCallback<unknown>) => {
    const ctx = getCurrentToolExecutionContext();
    const requestedSpaceId = getRequestedSpaceId(params);
    const targetSpaceId = requestedSpaceId ?? ctx?.spaceId;
    if (!targetSpaceId || !ctx?.spaceId || targetSpaceId === ctx.spaceId) {
      return sandboxTool.execute(toolCallId, withoutSpaceId(params), signal, onUpdate);
    }

    await checkAccess(targetSpaceId);
    return runWithToolExecutionContext({
      spaceId: targetSpaceId,
      sessionId: ctx.sessionId,
      turnId: ctx.turnId,
      turnSeq: ctx.turnSeq,
      llmRound: ctx.llmRound,
      toolCallId: ctx.toolCallId,
      metrics: ctx.metrics,
      actorUserId: ctx.actorUserId,
    }, () => sandboxTool.execute(toolCallId, withoutSpaceId(params), signal, onUpdate));
  };
}

export function createSpaceAwareReadTool(sandboxTool: AgentTool, checkAccess: AccessCheck): AgentTool {
  return {
    ...sandboxTool,
    parameters: Type.Object({
      path: Type.String({ description: "Path to the file to read (relative or absolute)" }),
      offset: Type.Optional(Type.Number({ description: "Line number to start reading from (1-indexed)" })),
      limit: Type.Optional(Type.Number({ description: "Maximum number of lines to read" })),
      space_id: Type.Optional(Type.String({ description: SPACE_ID_DESCRIPTION })),
    }),
    execute: routeExecute(sandboxTool, checkAccess),
  };
}

export function createSpaceAwareLsTool(sandboxTool: AgentTool, checkAccess: AccessCheck): AgentTool {
  return {
    ...sandboxTool,
    parameters: Type.Object({
      path: Type.Optional(Type.String({ description: "Directory to list (default: current directory)" })),
      limit: Type.Optional(Type.Number({ description: "Maximum number of entries to return (default: 500)" })),
      space_id: Type.Optional(Type.String({ description: SPACE_ID_DESCRIPTION })),
    }),
    execute: routeExecute(sandboxTool, checkAccess),
  };
}

export function createSpaceAwareFindTool(sandboxTool: AgentTool, checkAccess: AccessCheck): AgentTool {
  return {
    ...sandboxTool,
    parameters: Type.Object({
      path: Type.Optional(Type.String({ description: "Directory to search in (default: current directory)" })),
      pattern: Type.String({ description: "Glob pattern to match files" }),
      limit: Type.Optional(Type.Number({ description: "Maximum number of results" })),
      space_id: Type.Optional(Type.String({ description: SPACE_ID_DESCRIPTION })),
    }),
    execute: routeExecute(sandboxTool, checkAccess),
  };
}

export function createSpaceAwareGrepTool(sandboxTool: AgentTool, checkAccess: AccessCheck): AgentTool {
  return {
    ...sandboxTool,
    parameters: Type.Object({
      pattern: Type.String({ description: "Search pattern" }),
      path: Type.Optional(Type.String({ description: "Directory or file to search" })),
      glob: Type.Optional(Type.String({ description: "File glob filter" })),
      ignoreCase: Type.Optional(Type.Boolean({ description: "Case-insensitive search" })),
      literal: Type.Optional(Type.Boolean({ description: "Treat pattern as literal string" })),
      context: Type.Optional(Type.Number({ description: "Context lines" })),
      limit: Type.Optional(Type.Number({ description: "Maximum number of matches" })),
      space_id: Type.Optional(Type.String({ description: SPACE_ID_DESCRIPTION })),
    }),
    execute: routeExecute(sandboxTool, checkAccess),
  };
}
