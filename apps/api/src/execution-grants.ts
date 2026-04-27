import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "./config.js";

const EXECUTION_GRANT_TTL_SECONDS = 60 * 60;
const EXECUTION_GRANT_HEADER = { alg: "HS256", typ: "JWT" } as const;

export type ExecutionGrantPayload = {
  actorUserId: string | null;
  spaceId: string;
  sessionId: string | null;
  source: string;
  exp: number;
  iat: number;
};

function base64UrlEncode(value: string) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function base64UrlDecode(value: string) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function sign(input: string) {
  return createHmac("sha256", config.executionGrantSigningKey).update(input).digest("base64url");
}

export async function createExecutionGrant(input: {
  actorUserId?: string | null;
  spaceId: string;
  sessionId?: string | null;
  source?: string | null;
}) {
  const spaceId = input.spaceId?.trim();
  if (!spaceId) {
    throw new Error("Execution grant requires a non-empty spaceId");
  }
  const nowSeconds = Math.floor(Date.now() / 1000);
  const payload: ExecutionGrantPayload = {
    actorUserId: input.actorUserId?.trim() || null,
    spaceId,
    sessionId: input.sessionId?.trim() || null,
    source: input.source?.trim() || "prompt",
    iat: nowSeconds,
    exp: nowSeconds + EXECUTION_GRANT_TTL_SECONDS,
  };

  const encodedHeader = base64UrlEncode(JSON.stringify(EXECUTION_GRANT_HEADER));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = sign(signingInput);
  const token = `${signingInput}.${signature}`;

  return { token, expiresAt: payload.exp * 1000 };
}

export async function verifyExecutionGrant(token: string): Promise<ExecutionGrantPayload | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  const [encodedHeader, encodedPayload, providedSignature] = parts;
  if (!encodedHeader || !encodedPayload || !providedSignature) return null;

  const expectedSignature = sign(`${encodedHeader}.${encodedPayload}`);
  const provided = Buffer.from(providedSignature);
  const expected = Buffer.from(expectedSignature);
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return null;

  let parsedHeader: { alg?: string; typ?: string } | null = null;
  let parsedPayload: ExecutionGrantPayload | null = null;
  try {
    parsedHeader = JSON.parse(base64UrlDecode(encodedHeader)) as { alg?: string; typ?: string };
    parsedPayload = JSON.parse(base64UrlDecode(encodedPayload)) as ExecutionGrantPayload;
  } catch {
    return null;
  }

  if (parsedHeader?.alg !== "HS256" || parsedHeader?.typ !== "JWT") return null;
  if (!parsedPayload || typeof parsedPayload !== "object") return null;
  if (typeof parsedPayload.spaceId !== "string" || !parsedPayload.spaceId.trim()) return null;
  if (typeof parsedPayload.source !== "string" || !parsedPayload.source.trim()) return null;
  if (typeof parsedPayload.exp !== "number" || !Number.isFinite(parsedPayload.exp)) return null;
  if (typeof parsedPayload.iat !== "number" || !Number.isFinite(parsedPayload.iat)) return null;
  if (parsedPayload.exp <= Math.floor(Date.now() / 1000)) return null;

  return {
    actorUserId: typeof parsedPayload.actorUserId === "string" && parsedPayload.actorUserId.trim() ? parsedPayload.actorUserId.trim() : null,
    spaceId: parsedPayload.spaceId,
    sessionId: typeof parsedPayload.sessionId === "string" && parsedPayload.sessionId.trim() ? parsedPayload.sessionId.trim() : null,
    source: parsedPayload.source,
    exp: parsedPayload.exp,
    iat: parsedPayload.iat,
  };
}
