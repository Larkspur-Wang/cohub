import { createDecipheriv, createHash } from "node:crypto";
import { config } from "./config.js";

const ALGORITHM = "aes-256-gcm";

const getKey = () => createHash("sha256").update(config.executionGrantSigningKey).digest();

export const decryptSecret = (payload: string) => {
  const [ivB64, authTagB64, encryptedB64] = payload.split(":");
  if (!ivB64 || !authTagB64 || !encryptedB64) {
    throw new Error("Invalid encrypted secret payload");
  }
  const decipher = createDecipheriv(ALGORITHM, getKey(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(authTagB64, "base64"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedB64, "base64")),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
};
