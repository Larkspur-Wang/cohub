/** Structural equality for JSON-shaped semantic values. */
export function boardJsonEquals(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) {
    return Number.isNaN(a) && Number.isNaN(b);
  }
  const aArray = Array.isArray(a);
  const bArray = Array.isArray(b);
  if (aArray !== bArray) return false;
  if (aArray && bArray) return a.length === b.length && a.every((value, index) => boardJsonEquals(value, b[index]));
  const aRecord = a as Record<string, unknown>;
  const bRecord = b as Record<string, unknown>;
  const keys = Object.keys(aRecord);
  return keys.length === Object.keys(bRecord).length && keys.every((key) => Object.hasOwn(bRecord, key) && boardJsonEquals(aRecord[key], bRecord[key]));
}
