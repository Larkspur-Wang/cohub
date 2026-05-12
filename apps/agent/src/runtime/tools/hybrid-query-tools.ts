import { Type } from "@mariozechner/pi-ai";
import type { AgentTool, AgentToolUpdateCallback } from "@mariozechner/pi-agent-core";
import { getCurrentToolExecutionContext } from "../../tool-context.js";

const SPACE_ID_DESCRIPTION = "Only set when querying another space by id";

function getRequestedSpaceId(params: unknown) {
  if (!params || typeof params !== "object") return null;
  const value = (params as Record<string, unknown>).space_id;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function shouldUseCrossSpace(params: unknown) {
  const spaceId = getRequestedSpaceId(params);
  if (!spaceId) return false;
  const ctx = getCurrentToolExecutionContext();
  return !ctx?.spaceId || spaceId !== ctx.spaceId;
}

function withoutSpaceId(input: unknown) {
  if (!input || typeof input !== "object") return input;
  const { space_id: _spaceId, ...rest } = input as Record<string, unknown>;
  return rest;
}

function routeExecute(sandboxTool: AgentTool, crossSpaceTool: AgentTool) {
  return (toolCallId: string, params: unknown, signal?: AbortSignal, onUpdate?: AgentToolUpdateCallback<unknown>) => {
    if (shouldUseCrossSpace(params)) {
      return crossSpaceTool.execute(toolCallId, params, signal, onUpdate);
    }
    return sandboxTool.execute(toolCallId, withoutSpaceId(params), signal, onUpdate);
  };
}

export function createHybridReadTool(sandboxTool: AgentTool, crossSpaceTool: AgentTool): AgentTool {
  return {
    ...sandboxTool,
    parameters: Type.Object({
      path: Type.String({ description: "Path to the file to read (relative or absolute)" }),
      offset: Type.Optional(Type.Number({ description: "Line number to start reading from (1-indexed)" })),
      limit: Type.Optional(Type.Number({ description: "Maximum number of lines to read" })),
      space_id: Type.Optional(Type.String({ description: SPACE_ID_DESCRIPTION })),
    }),
    execute: routeExecute(sandboxTool, crossSpaceTool),
  };
}

export function createHybridLsTool(sandboxTool: AgentTool, crossSpaceTool: AgentTool): AgentTool {
  return {
    ...sandboxTool,
    parameters: Type.Object({
      path: Type.Optional(Type.String({ description: "Directory to list (default: current directory)" })),
      limit: Type.Optional(Type.Number({ description: "Maximum number of entries to return (default: 500)" })),
      space_id: Type.Optional(Type.String({ description: SPACE_ID_DESCRIPTION })),
    }),
    execute: routeExecute(sandboxTool, crossSpaceTool),
  };
}

export function createHybridFindTool(sandboxTool: AgentTool, crossSpaceTool: AgentTool): AgentTool {
  return {
    ...sandboxTool,
    parameters: Type.Object({
      path: Type.Optional(Type.String({ description: "Directory to search in (default: current directory)" })),
      pattern: Type.String({ description: "Glob pattern to match files" }),
      limit: Type.Optional(Type.Number({ description: "Maximum number of results" })),
      space_id: Type.Optional(Type.String({ description: SPACE_ID_DESCRIPTION })),
    }),
    execute: routeExecute(sandboxTool, crossSpaceTool),
  };
}

export function createHybridGrepTool(sandboxTool: AgentTool, crossSpaceTool: AgentTool): AgentTool {
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
    execute: routeExecute(sandboxTool, crossSpaceTool),
  };
}
