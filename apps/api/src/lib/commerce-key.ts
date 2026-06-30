const DEFAULT_COMMERCE_KEY_MAX_LENGTH = 64;
const COLLISION_SUFFIX_LIMIT = 10_000;

function normalizeCommerceKeyBase(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function fitCommerceKey(value: string, maxLength: number): string {
  return value.slice(0, maxLength).replace(/_+$/g, "");
}

function hashCommerceKeyText(value: string): string {
  let hash = 0x811c9dc5;
  for (const char of value) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

export function createCommerceKey(input: {
  name: string;
  fallback: "product" | "benefit";
  occupiedKeys?: Iterable<string>;
  maxLength?: number;
}): string {
  const maxLength = input.maxLength ?? DEFAULT_COMMERCE_KEY_MAX_LENGTH;
  const occupied = new Set(input.occupiedKeys ?? []);
  const fallback = fitCommerceKey(input.fallback, maxLength);
  const normalized = normalizeCommerceKeyBase(input.name);
  const rawBase = normalized || (input.name.trim() ? `${fallback}_${hashCommerceKeyText(input.name)}` : fallback);
  const base = fitCommerceKey(rawBase, maxLength) || fallback;

  if (!occupied.has(base)) return base;

  for (let index = 2; index < COLLISION_SUFFIX_LIMIT; index += 1) {
    const suffix = `_${index}`;
    const candidateBase = fitCommerceKey(base, Math.max(1, maxLength - suffix.length)) || fallback;
    const candidate = `${candidateBase}${suffix}`;
    if (!occupied.has(candidate)) return candidate;
  }

  const randomSuffix = `_${crypto.randomUUID().replace(/-/g, "").slice(0, 8)}`;
  const candidateBase = fitCommerceKey(base, Math.max(1, maxLength - randomSuffix.length)) || fallback;
  return `${candidateBase}${randomSuffix}`;
}
