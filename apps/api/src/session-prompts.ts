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

const promptDependencies = {
  randomUUID,
  expandPromptTemplate: (input: { text: string; userId: string; spaceId: string }) =>
    expandPromptTemplate(input.text, { userId: input.userId, spaceId: input.spaceId }),
  createExecutionGrant,
  createSessionTurn,
  enqueueSpacePrompt,
  failSessionTurn,
};

export const expandPromptContent = async (input: {
  content: ContentBlock[];
  userId: string;
  spaceId: string;
}) => expandCorePromptContent(promptDependencies, input);

export const submitSessionPrompt = async (
  input: SubmitSessionPromptInput,
  hooks: SubmitSessionPromptHooks = {},
): Promise<SubmitSessionPromptResult> => submitCoreSessionPrompt(promptDependencies, input, hooks);
