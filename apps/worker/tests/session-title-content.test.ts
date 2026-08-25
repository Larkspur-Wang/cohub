import assert from "node:assert/strict";
import { test } from "node:test";
import type { ContentBlock } from "@cohub/protocol/core";
import {
  buildSessionTitleContent,
  unwrapGenerationRequest,
} from "../src/session-title-content.js";

const image: ContentBlock = {
  type: "image",
  source: { type: "url", url: "https://example.com/image.png" },
};

test("keeps text and images for a multimodal title model", () => {
  const result = buildSessionTitleContent([
    { type: "text", text: "Identify this interface" },
    image,
  ], true);

  assert.equal(result.hasImages, true);
  assert.equal(result.parts.length, 2);
  assert.equal(result.parts[0]?.type, "text");
  assert.equal(result.parts[1]?.type, "image");
});

test("leaves images out of text-only title input for image-to-text fallback", () => {
  const result = buildSessionTitleContent([image], false);
  assert.equal(result.hasImages, true);
  assert.deepEqual(result.parts, []);
});

test("unwraps generation request content before title generation", () => {
  const nested = [{ type: "text", text: "Create a product mockup" }, image] satisfies ContentBlock[];
  const content: ContentBlock[] = [{
    type: "text",
    text: JSON.stringify({ type: "generation.request", content: nested }),
  }];

  assert.deepEqual(unwrapGenerationRequest(content), nested);
});
