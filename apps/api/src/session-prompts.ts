import { randomUUID } from "node:crypto";
import {
  submitSessionPrompt as submitCoreSessionPrompt,
  expandPromptContent as expandCorePromptContent,
  type ChannelPromptContext,
  type PromptSource,
  type PromptTemplateUsageMeta,
  type PublicApiPromptContext,
  type ScheduledTaskPromptContext,
  type SubmitSessionPromptContext,
  type SubmitSessionPromptError,
  type SubmitSessionPromptHooks,
  type SubmitSessionPromptInput,
  type SubmitSessionPromptResult,
  type WebAppPromptContext,
  type WebsocketPromptContext,
} from "@cohub/core/sessions";
import type { ContentBlock } from "@cohub/protocol/core";
import { createExecutionGrant } from "./execution-grants.js";
import { enqueueSpacePrompt } from "./space-sessions.js";
import { createSessionTurn, failSessionTurn } from "./session-turns.js";
import { expandPromptTemplate } from "./prompt-templates.js";

export type {
  ChannelPromptContext,
  PromptSource,
  PromptTemplateUsageMeta,
  PublicApiPromptContext,
  ScheduledTaskPromptContext,
  SubmitSessionPromptContext,
  SubmitSessionPromptError,
  SubmitSessionPromptHooks,
  SubmitSessionPromptInput,
  SubmitSessionPromptResult,
  WebAppPromptContext,
  WebsocketPromptContext,
};

const createPromptDependencies = () => ({
  randomUUID,
  expandPromptTemplate: (input: { text: string; userId: string; spaceId: string }) =>
    expandPromptTemplate(input.text, { userId: input.userId, spaceId: input.spaceId }),
  createExecutionGrant,
  createSessionTurn,
  enqueueSpacePrompt: async (input: {
    spaceId: string;
    sessionId: string;
    turnId: string;
    userMessageId: string;
    content: ContentBlock[];
    meta: Record<string, unknown>;
  }) => {
    const executionAuth = input.meta.executionAuth;
    if (!executionAuth || typeof executionAuth !== "object" || Array.isArray(executionAuth)) {
      throw new Error("execution auth is required");
    }
    const { token, expiresAt } = executionAuth as { token?: unknown; expiresAt?: unknown };
    if (typeof token !== "string" || typeof expiresAt !== "number") {
      throw new Error("invalid execution auth");
    }
    await enqueueSpacePrompt({
      ...input,
      executionAuth: { token, expiresAt },
    });
  },
  failSessionTurn,
});

export const expandPromptContent = async (input: {
  content: ContentBlock[];
  userId: string;
  spaceId: string;
}) => expandCorePromptContent(createPromptDependencies(), input);

export const submitSessionPrompt = async (
  input: SubmitSessionPromptInput,
  hooks: SubmitSessionPromptHooks = {},
): Promise<SubmitSessionPromptResult> => submitCoreSessionPrompt(createPromptDependencies(), input, hooks);
