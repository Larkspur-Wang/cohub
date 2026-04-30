import { Readable } from "node:stream";

export const FEISHU_INBOUND_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
export const FEISHU_INBOUND_IMAGE_TIMEOUT_MS = 15_000;
export const FEISHU_INBOUND_IMAGE_MAX_COUNT = 8;

function getReadableStream(response: unknown): Readable {
  if (!response || typeof response !== "object") {
    throw new Error("Feishu resource response is empty");
  }

  const candidate = response as { getReadableStream?: unknown };
  if (typeof candidate.getReadableStream !== "function") {
    throw new Error("Feishu resource response does not expose getReadableStream()");
  }

  const stream = candidate.getReadableStream() as unknown;
  if (!(stream instanceof Readable)) {
    throw new Error("Feishu resource stream is not a Node.js Readable");
  }

  return stream;
}

async function readStreamWithLimit(stream: Readable, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;

  for await (const chunk of stream as AsyncIterable<Buffer | Uint8Array | string>) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > maxBytes) {
      stream.destroy(new Error(`Feishu resource exceeds ${maxBytes} bytes`));
      throw new Error(`Feishu resource exceeds ${maxBytes} bytes`);
    }
    chunks.push(buffer);
  }

  return Buffer.concat(chunks, total);
}

export async function readFeishuResourceBuffer(
  response: unknown,
  options: { maxBytes?: number; timeoutMs?: number } = {},
): Promise<Buffer> {
  const maxBytes = options.maxBytes ?? FEISHU_INBOUND_IMAGE_MAX_BYTES;
  const timeoutMs = options.timeoutMs ?? FEISHU_INBOUND_IMAGE_TIMEOUT_MS;
  const stream = getReadableStream(response);

  let timeout: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      stream.destroy(new Error(`Feishu resource download timed out after ${timeoutMs}ms`));
      reject(new Error(`Feishu resource download timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([readStreamWithLimit(stream, maxBytes), timeoutPromise]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
