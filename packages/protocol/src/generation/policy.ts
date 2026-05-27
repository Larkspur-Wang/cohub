import type { GenerationModelDeclaration } from "@neta-art/generation";

export const GENERATION_POLICY_ENV_KEY = "COHUB_GENERATION_POLICY_B64" as const;

export type GenerationPolicy = {
  version: 1;
  mode: "auto" | "limited";
  models?: GenerationModelPolicy[];
};

export type GenerationModelPolicy = {
  model: string;
  /**
   * Generic constraints keyed by generation declaration parameter name.
   * Missing parameters are not restricted by policy.
   */
  parameters?: Record<string, GenerationParameterConstraint>;
};

export type GenerationParameterConstraint =
  | { kind: "enum"; values: Array<string | number | boolean> }
  | { kind: "number"; min?: number; max?: number; values?: number[] }
  | { kind: "integer"; min?: number; max?: number; values?: number[] }
  | { kind: "boolean"; value?: boolean };

export class GenerationPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GenerationPolicyError";
  }
}

type EnvLike = Record<string, string | undefined>;
type PublicDeclaration = Omit<GenerationModelDeclaration, "adapter">;
type ParameterSpec = NonNullable<PublicDeclaration["parameters"]>[string];

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isPrimitiveEnumValue(value: unknown): value is string | number | boolean {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

function normalizeConstraint(value: unknown): GenerationParameterConstraint | null {
  if (!isRecord(value) || typeof value.kind !== "string") return null;
  if (value.kind === "enum") {
    if (!Array.isArray(value.values) || value.values.length === 0 || !value.values.every(isPrimitiveEnumValue)) return null;
    return { kind: "enum", values: value.values };
  }
  if (value.kind === "number" || value.kind === "integer") {
    const result: Extract<GenerationParameterConstraint, { kind: "number" | "integer" }> = { kind: value.kind };
    if (typeof value.min === "number" && Number.isFinite(value.min)) result.min = value.min;
    if (typeof value.max === "number" && Number.isFinite(value.max)) result.max = value.max;
    if (result.min !== undefined && result.max !== undefined && result.min > result.max) return null;
    if (Array.isArray(value.values) && value.values.every((item) => typeof item === "number" && Number.isFinite(item))) {
      if (value.kind === "integer" && !value.values.every(Number.isInteger)) return null;
      const min = result.min;
      const max = result.max;
      if (min !== undefined && value.values.some((item) => item < min)) return null;
      if (max !== undefined && value.values.some((item) => item > max)) return null;
      result.values = value.values;
    }
    return result;
  }
  if (value.kind === "boolean") {
    return typeof value.value === "boolean" ? { kind: "boolean", value: value.value } : { kind: "boolean" };
  }
  return null;
}

export function normalizeGenerationPolicy(value: unknown): GenerationPolicy | null {
  if (!isRecord(value) || value.version !== 1) return null;
  if (value.mode === "auto") return { version: 1, mode: "auto" };
  if (value.mode !== "limited" || !Array.isArray(value.models) || value.models.length === 0) return null;

  const models: GenerationModelPolicy[] = [];
  for (const item of value.models) {
    if (!isRecord(item) || typeof item.model !== "string" || !item.model.trim()) return null;
    const modelPolicy: GenerationModelPolicy = { model: item.model.trim() };
    if (item.parameters !== undefined) {
      if (!isRecord(item.parameters)) return null;
      const parameters: Record<string, GenerationParameterConstraint> = {};
      for (const [key, rawConstraint] of Object.entries(item.parameters)) {
        if (!key.trim()) return null;
        const constraint = normalizeConstraint(rawConstraint);
        if (!constraint) return null;
        parameters[key] = constraint;
      }
      if (Object.keys(parameters).length > 0) modelPolicy.parameters = parameters;
    }
    models.push(modelPolicy);
  }

  return { version: 1, mode: "limited", models };
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function toBase64Url(value: string): string {
  return bytesToBase64(new TextEncoder().encode(value))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function fromBase64Url(value: string): string {
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = base64.padEnd(base64.length + ((4 - base64.length % 4) % 4), "=");
  return new TextDecoder().decode(base64ToBytes(padded));
}

export function encodeGenerationPolicy(policy: GenerationPolicy): string {
  return toBase64Url(JSON.stringify(policy));
}

export function decodeGenerationPolicy(value: string): GenerationPolicy | null {
  try {
    const parsed = JSON.parse(fromBase64Url(value)) as unknown;
    return normalizeGenerationPolicy(parsed);
  } catch {
    return null;
  }
}

export function parseGenerationPolicyFromEnv(env: EnvLike): GenerationPolicy | null {
  const value = env[GENERATION_POLICY_ENV_KEY]?.trim();
  return value ? decodeGenerationPolicy(value) : null;
}

export function getAllowedGenerationModelIds(policy: GenerationPolicy | null): string[] | null {
  if (!policy || policy.mode === "auto") return null;
  return [...new Set((policy.models ?? []).map((item) => item.model))];
}

export function findGenerationModelPolicy(policy: GenerationPolicy | null, model: string): GenerationModelPolicy | null {
  if (!policy || policy.mode === "auto") return null;
  return policy.models?.find((item) => item.model === model) ?? null;
}

function formatList(values: unknown[]): string {
  return values.map((value) => `- ${String(value)}`).join("\n");
}

function modelNotSupportedMessage(allowedModels: string[]): string {
  return [
    "This turn supports the following generation models:",
    "",
    formatList(allowedModels),
    "",
    "Choose one of these models or update Generation settings in the Models panel.",
  ].join("\n");
}

function valuesNotSupportedMessage(model: string, name: string, values: unknown[], received: unknown): string {
  return [
    `This turn supports selected values for ${model}.${name}:`,
    "",
    formatList(values),
    "",
    "Received:",
    `- ${String(received)}`,
  ].join("\n");
}

function rangeNotSupportedMessage(model: string, name: string, min: number | undefined, max: number | undefined, received: unknown): string {
  const range = min !== undefined && max !== undefined ? `${min}–${max}` : min !== undefined ? `at least ${min}` : `at most ${max}`;
  return [
    `This turn supports ${model}.${name} in the range ${range}.`,
    "",
    "Received:",
    `- ${String(received)}`,
  ].join("\n");
}

function booleanNotSupportedMessage(model: string, name: string, expected: boolean, received: unknown): string {
  return [
    `This turn supports ${model}.${name}=${String(expected)}.`,
    "",
    "Received:",
    `- ${String(received)}`,
  ].join("\n");
}

function sameEnumValue(a: unknown, b: unknown): boolean {
  return typeof a === typeof b && a === b;
}

function validateConstraint(input: {
  model: string;
  name: string;
  value: unknown;
  constraint: GenerationParameterConstraint;
}) {
  const { model, name, value, constraint } = input;
  if (constraint.kind === "enum") {
    if (!constraint.values.some((item) => sameEnumValue(item, value))) {
      throw new GenerationPolicyError(valuesNotSupportedMessage(model, name, constraint.values, value));
    }
    return;
  }

  if (constraint.kind === "number" || constraint.kind === "integer") {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new GenerationPolicyError(rangeNotSupportedMessage(model, name, constraint.min, constraint.max, value));
    }
    if (constraint.kind === "integer" && !Number.isInteger(value)) {
      throw new GenerationPolicyError(rangeNotSupportedMessage(model, name, constraint.min, constraint.max, value));
    }
    if (constraint.values?.length && !constraint.values.includes(value)) {
      throw new GenerationPolicyError(valuesNotSupportedMessage(model, name, constraint.values, value));
    }
    if (constraint.min !== undefined && value < constraint.min) {
      throw new GenerationPolicyError(rangeNotSupportedMessage(model, name, constraint.min, constraint.max, value));
    }
    if (constraint.max !== undefined && value > constraint.max) {
      throw new GenerationPolicyError(rangeNotSupportedMessage(model, name, constraint.min, constraint.max, value));
    }
    return;
  }

  if (constraint.kind === "boolean" && constraint.value !== undefined && value !== constraint.value) {
    throw new GenerationPolicyError(booleanNotSupportedMessage(model, name, constraint.value, value));
  }
}

export function assertGenerationRequestAllowedByPolicy(input: {
  policy: GenerationPolicy | null;
  model: string;
  parameters?: Record<string, unknown>;
}): void {
  const allowedModels = getAllowedGenerationModelIds(input.policy);
  if (!allowedModels) return;
  const modelPolicy = findGenerationModelPolicy(input.policy, input.model);
  if (!modelPolicy) throw new GenerationPolicyError(modelNotSupportedMessage(allowedModels));

  const parameters = input.parameters ?? {};
  for (const [name, value] of Object.entries(parameters)) {
    const constraint = modelPolicy.parameters?.[name];
    if (!constraint) continue;
    validateConstraint({ model: input.model, name, value, constraint });
  }
}

function cloneDeclaration<T extends PublicDeclaration>(declaration: T): T {
  return {
    ...declaration,
    content: {
      ...declaration.content,
      input: [...declaration.content.input],
    },
    parameters: declaration.parameters
      ? Object.fromEntries(Object.entries(declaration.parameters).map(([key, value]) => [key, { ...value }])) as T["parameters"]
      : declaration.parameters,
    examples: declaration.examples ? [...declaration.examples] : declaration.examples,
  };
}

function narrowParameterSpec(spec: ParameterSpec, constraint: GenerationParameterConstraint): ParameterSpec {
  const next = { ...spec } as ParameterSpec;
  if (constraint.kind === "enum") {
    if ("enum" in next && Array.isArray(next.enum)) {
      next.enum = next.enum.filter((value) => constraint.values.some((allowed) => sameEnumValue(allowed, value))) as never;
    }
    return next;
  }
  if (constraint.kind === "number" || constraint.kind === "integer") {
    if ("min" in next && typeof next.min === "number" && constraint.min !== undefined) next.min = Math.max(next.min, constraint.min) as never;
    else if ("min" in next && constraint.min !== undefined) next.min = constraint.min as never;
    if ("max" in next && typeof next.max === "number" && constraint.max !== undefined) next.max = Math.min(next.max, constraint.max) as never;
    else if ("max" in next && constraint.max !== undefined) next.max = constraint.max as never;
    if (constraint.values?.length && "enum" in next && Array.isArray(next.enum)) {
      next.enum = next.enum.filter((value) => constraint.values?.some((allowed) => sameEnumValue(allowed, value))) as never;
    }
  }
  return next;
}

export function filterGenerationDeclarationsByPolicy<T extends PublicDeclaration>(declarations: T[], policy: GenerationPolicy | null): T[] {
  const allowedModels = getAllowedGenerationModelIds(policy);
  if (!allowedModels) return declarations;
  const allowedSet = new Set(allowedModels);
  return declarations
    .filter((declaration) => allowedSet.has(declaration.model))
    .map((declaration) => {
      const cloned = cloneDeclaration(declaration);
      const modelPolicy = findGenerationModelPolicy(policy, declaration.model);
      if (!modelPolicy?.parameters || !cloned.parameters) return cloned;
      for (const [name, constraint] of Object.entries(modelPolicy.parameters)) {
        const spec = cloned.parameters[name];
        if (spec) cloned.parameters[name] = narrowParameterSpec(spec, constraint) as never;
      }
      return cloned;
    });
}
