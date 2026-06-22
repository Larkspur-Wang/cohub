import { createCipheriv, createDecipheriv } from "node:crypto";

export function encryptAesEcb(plaintext: Buffer, key: Buffer) {
  const cipher = createCipheriv("aes-128-ecb", key, null);
  return Buffer.concat([cipher.update(plaintext), cipher.final()]);
}

export function decryptAesEcb(ciphertext: Buffer, key: Buffer) {
  const decipher = createDecipheriv("aes-128-ecb", key, null);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

export function aesEcbPaddedSize(plaintextSize: number) {
  return Math.ceil((plaintextSize + 1) / 16) * 16;
}

export function parseWeChatAesKey(value: string, label: string) {
  const decoded = Buffer.from(value, "base64");
  if (decoded.length === 16) return decoded;
  if (decoded.length === 32 && /^[0-9a-fA-F]{32}$/.test(decoded.toString("ascii"))) {
    return Buffer.from(decoded.toString("ascii"), "hex");
  }
  throw new Error(`${label}: AES key must decode to 16 raw bytes or 32 hex bytes`);
}
