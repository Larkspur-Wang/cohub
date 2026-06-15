import { COHUB_BILLING_POLICY } from "./constants.js";
import { createBillingConversionIntent, type BillingConversionIntent } from "./conversion.js";
import { COHUB_BILLING_TOKEN_TYPES, type BillingOperations } from "./interfaces.js";

export type BillingUsageKind =
  | "llm.turn"
  | "generation"
  | "generation.image"
  | "generation.video"
  | "sandbox.compute"
  | (string & {});

export type BillingUsageSource =
  | "session_prompt"
  | "scheduled_prompt"
  | "generation_task"
  | "agent_llm_call"
  | (string & {});

export type BillingUsageGateInput = {
  userId: string;
  usageKind: BillingUsageKind;
  source: BillingUsageSource;
  model?: string | null;
  provider?: string | null;
  spaceId?: string | null;
  sessionId?: string | null;
  turnId?: string | null;
};

export type BillingAccessDecision =
  | {
      status: "allowed";
      balanceState: "positive" | "zero";
      netUsd: number;
    }
  | {
      status: "allowed_with_debt";
      balanceState: "negative";
      netUsd: number;
      hardNegativeLimitUsd: number;
      conversion: BillingConversionIntent;
    }
  | {
      status: "blocked";
      code: "billing_credit_limit_exceeded";
      balanceState: "negative";
      netUsd: number;
      hardNegativeLimitUsd: number;
      conversion: BillingConversionIntent;
    };

export type BillingUsageGate = {
  evaluate(input: BillingUsageGateInput): Promise<BillingAccessDecision>;
};

export function createBillingUsageGate(input: {
  operations: Pick<BillingOperations, "getCreditStatus">;
  hardNegativeLimitUsd?: number;
  tokenType?: string;
  onEvaluationError?: (error: unknown, gateInput: BillingUsageGateInput) => void;
}): BillingUsageGate {
  const hardNegativeLimitUsd = input.hardNegativeLimitUsd ?? COHUB_BILLING_POLICY.hardNegativeLimitUsd;
  if (hardNegativeLimitUsd > 0) {
    throw new Error("hardNegativeLimitUsd must be zero or negative");
  }
  const tokenType = input.tokenType ?? COHUB_BILLING_TOKEN_TYPES.usdMicroCent;

  return {
    async evaluate(gateInput) {
      let netUsd = 0;
      try {
        const credit = await input.operations.getCreditStatus({
          userId: gateInput.userId,
          tokenType,
        });
        netUsd = Number.isFinite(credit.netUsd) ? credit.netUsd : 0;
      } catch (error) {
        input.onEvaluationError?.(error, gateInput);
        return { status: "allowed", balanceState: "zero", netUsd };
      }
      if (netUsd > 0) {
        return { status: "allowed", balanceState: "positive", netUsd };
      }
      if (netUsd === 0) {
        return { status: "allowed", balanceState: "zero", netUsd };
      }
      if (netUsd >= hardNegativeLimitUsd) {
        return {
          status: "allowed_with_debt",
          balanceState: "negative",
          netUsd,
          hardNegativeLimitUsd,
          conversion: createBillingConversionIntent({
            level: "soft",
            reason: "negative_balance",
            source: gateInput.source,
          }),
        };
      }
      return {
        status: "blocked",
        code: "billing_credit_limit_exceeded",
        balanceState: "negative",
        netUsd,
        hardNegativeLimitUsd,
        conversion: createBillingConversionIntent({
          level: "hard",
          reason: "negative_balance_limit_exceeded",
          source: gateInput.source,
        }),
      };
    },
  };
}
