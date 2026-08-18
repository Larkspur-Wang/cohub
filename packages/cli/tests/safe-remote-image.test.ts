import assert from "node:assert/strict";
import { test } from "node:test";
import {
  downloadPublicImage,
  type RemoteImageDownloadOptions,
} from "../src/safe-remote-image.js";

const publicLookup = async () => [{ address: "8.8.8.8", family: 4 as const }];
const response = (bytes = [1, 2, 3], status = 200, headers: HeadersInit = {}) => ({
  status,
  headers: new Headers({ "content-type": "image/png", ...headers }),
  bytes: new Uint8Array(bytes),
});
const requester = (
  result: ReturnType<typeof response>,
  connected?: string[],
): NonNullable<RemoteImageDownloadOptions["requester"]> =>
  async (_url, address) => {
    connected?.push(address.address);
    return result;
  };

test("pins downloads to the validated address", async () => {
  const connected: string[] = [];
  const result = await downloadPublicImage("https://cdn.example/image.png", {
    lookup: publicLookup,
    requester: requester(response(), connected),
  });
  assert.deepEqual([...result.bytes], [1, 2, 3]);
  assert.deepEqual(connected, ["8.8.8.8"]);
});

test("blocks a redirect that resolves to a private address", async () => {
  const connected: string[] = [];
  await assert.rejects(
    downloadPublicImage("https://cdn.example/image.png", {
      lookup: async (hostname) =>
        hostname === "internal.example"
          ? [{ address: "10.0.0.1", family: 4 }]
          : [{ address: "8.8.8.8", family: 4 }],
      requester: requester(
        response([], 302, { location: "https://internal.example/metadata" }),
        connected,
      ),
    }),
    /private address/,
  );
  assert.deepEqual(connected, ["8.8.8.8"]);
});

test("bounds download size and DNS time", async () => {
  await assert.rejects(
    downloadPublicImage("https://cdn.example/image.png", {
      lookup: publicLookup,
      maxBytes: 2,
      requester: requester(response()),
    }),
    /download limit/,
  );
  await assert.rejects(
    downloadPublicImage("https://cdn.example/image.png", {
      timeoutMs: 5,
      lookup: () => new Promise(() => undefined),
      requester: requester(response()),
    }),
    /timed out/,
  );
});
