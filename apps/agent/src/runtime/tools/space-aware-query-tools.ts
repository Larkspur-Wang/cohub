import { Type } from "@earendil-works/pi-ai";
import type { AgentTool, AgentToolUpdateCallback } from "@earendil-works/pi-agent-core";
import { getCurrentToolExecutionContext, runWithToolExecutionContext } from "../../tool-context.js";
import { assertCrossSpaceQueryPathAllowed } from "./query-path-policy.js";

const SPACE_ID_DESCRIPTION = "Only set when querying another space by id";

type AccessCheck = (spaceId: string) => Promise<void>;

type SpaceAwareToolOptions = {
  sandboxTool: AgentTool;
  crossSpaceTool: AgentTool;
  checkAccess: AccessCheck;
};

function getRequestedSpaceId(params: unknown) {
  if (!params || typeof params !== "object") return null;
  const value = (params as Record<string, unknown>).space_id;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function getQueryPath(params: unknown) {
  if (!params || typeof params !== "object") return undefined;
  return (params as Record<string, unknown>).path;
}

function withoutSpaceId(input: unknown) {
  if (!input || typeof input !== "object") return input;
  const { space_id: _spaceId, ...rest } = input as Record<string, unknown>;
  return rest;
}

function routeExecute({ sandboxTool, crossSpaceTool, checkAccess }: SpaceAwareToolOptions) {
  return async (toolCallId: string, params: unknown, signal?: AbortSignal, onUpdate?: AgentToolUpdateCallback<unknown>) => {
    const ctx = getCurrentToolExecutionContext();
    if (!ctx?.spaceId) {
      throw new Error("Tool execution context is missing spaceId");
    }

    const requestedSpaceId = getRequestedSpaceId(params);
    const targetSpaceId = requestedSpaceId ?? ctx.spaceId;
    const tool = targetSpaceId === ctx.spaceId ? sandboxTool : crossSpaceTool;
    if (targetSpaceId !== ctx.spaceId) {
      assertCrossSpaceQueryPathAllowed(getQueryPath(params));
      await checkAccess(targetSpaceId);
    }

    return runWithToolExecutionContext({
      ...ctx,
      spaceId: targetSpaceId,
    }, () => tool.execute(toolCallId, withoutSpaceId(params), signal, onUpdate));
  };
}

export function createSpaceAwareReadTool(options: SpaceAwareToolOptions): AgentTool {
  return {
    ...options.sandboxTool,
    parameters: Type.Object({
      path: Type.String({ description: "Path to the file to read (relative or absolute)" }),
      offset: Type.Optional(Type.Number({ description: "Line number to start reading from (1-indexed)" })),
      limit: Type.Optional(Type.Number({ description: "Maximum number of lines to read" })),
      space_id: Type.Optional(Type.String({ description: SPACE_ID_DESCRIPTION })),
    }),
    execute: routeExecute(options),
  };
}

export function createSpaceAwareLsTool(options: SpaceAwareToolOptions): AgentTool {
  return {
    ...options.sandboxTool,
    parameters: Type.Object({
      path: Type.Optional(Type.String({ description: "Directory to list (default: current directory)" })),
      limit: Type.Optional(Type.Number({ description: "Maximum number of entries to return (default: 500)" })),
      space_id: Type.Optional(Type.String({ description: SPACE_ID_DESCRIPTION })),
    }),
    execute: routeExecute(options),
  };
}

export function createSpaceAwareFindTool(options: SpaceAwareToolOptions): AgentTool {
  return {
    ...options.sandboxTool,
    parameters: Type.Object({
      path: Type.Optional(Type.String({ description: "Directory to search in (default: current directory)" })),
      pattern: Type.String({ description: "Glob pattern to match files" }),
      limit: Type.Optional(Type.Number({ description: "Maximum number of results" })),
      space_id: Type.Optional(Type.String({ description: SPACE_ID_DESCRIPTION })),
    }),
    execute: routeExecute(options),
  };
}

export function createSpaceAwareGrepTool(options: SpaceAwareToolOptions): AgentTool {
  return {
    ...options.sandboxTool,
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
    execute: routeExecute(options),
  };
}
