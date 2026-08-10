import { isRequestSourceClientId } from "@cohub/protocol/provenance";

export type RunCommandExecutionContext = {
  sourceClientId: string | null;
  model: { provider: string; id: string } | null;
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;

export function parseRunCommandExecutionContext(data: Record<string, unknown>): RunCommandExecutionContext {
  const rawClientId = typeof data.sourceClientId === "string" ? data.sourceClientId.trim() : "";
  const model = asRecord(data.model);
  const provider = typeof model?.provider === "string" ? model.provider.trim() : "";
  const id = typeof model?.id === "string" ? model.id.trim() : "";

  return {
    sourceClientId: isRequestSourceClientId(rawClientId) ? rawClientId : null,
    model: provider && id ? { provider, id } : null,
  };
}
