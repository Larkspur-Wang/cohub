import type {
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
} from "@cohub/core/sessions";
import type { ContentBlock } from "@cohub/protocol/core";
import {
  billingOperations,
  COHUB_BILLING_TOKEN_TYPES,
  COHUB_BILLING_USAGE_TYPES,
  type BillingUsagePreflight,
} from "./billing/index.js";
import { getSessionDomainServices } from "./session-services.js";

const LLM_PREFLIGHT_MIN_BALANCE_USD = 0.00000001;

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

export const expandPromptContent = async (input: {
  content: ContentBlock[];
  userId: string;
  spaceId: string;
}) => getSessionDomainServices().expandPromptContent(input);

export class BillingPreflightError extends Error {
  constructor(public readonly preflight: BillingUsagePreflight) {
    super("insufficient billing balance");
    this.name = "BillingPreflightError";
  }
}

async function runBillingPreflight(
  input: SubmitSessionPromptInput,
  hookInput: Parameters<NonNullable<SubmitSessionPromptHooks["beforeEnqueue"]>>[0],
) {
  if (!billingOperations.status.configured) return;
  if (hookInput.meta.llm === false) return;
  const userId = input.userId.trim();
  if (!userId) return;

  const preflight = await billingOperations.preflightUsage({
    userId,
    tokenType: COHUB_BILLING_TOKEN_TYPES.usdMicroCent,
    usageType: COHUB_BILLING_USAGE_TYPES.generationLlm,
    estimatedAmountUsd: LLM_PREFLIGHT_MIN_BALANCE_USD,
  });
  if (!preflight.allowed) throw new BillingPreflightError(preflight);
}

export const submitSessionPrompt = async (
  input: SubmitSessionPromptInput,
  hooks: SubmitSessionPromptHooks = {},
): Promise<SubmitSessionPromptResult> => getSessionDomainServices().submitPrompt(input, {
  ...hooks,
  beforeEnqueue: async (hookInput) => {
    await runBillingPreflight(input, hookInput);
    await hooks.beforeEnqueue?.(hookInput);
  },
});
