import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

import { config } from "./config.js";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

const getKey = () => createHash("sha256").update(config.appEncryptionKey).digest();

export const encryptSecret = (plaintext: string) => {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString("base64"), authTag.toString("base64"), encrypted.toString("base64")].join(":");
};

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
