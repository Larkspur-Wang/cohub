import assert from "node:assert/strict";
import test from "node:test";
import {
  buildGenerationRequestMessage,
  buildGenerationResultMessage,
} from "./src/generation/session-messages.js";

test("generation request messages preserve the JSON envelope and image projection", () => {
  const message = buildGenerationRequestMessage({
    taskId: "task-1",
    model: "image-model",
    provider: "openai.images",
    parameters: { size: "1024x1024" },
    content: [
      { type: "text", text: "a cabin" },
      { type: "image", source: { type: "url", url: "https://example.com/input.png" } },
    ],
  });

  const text = message.content.find((block) => block.type === "text");
  assert.ok(text && text.type === "text");
  assert.deepEqual(JSON.parse(text.text), {
    version: 1,
    type: "generation.request",
    taskId: "task-1",
    model: "image-model",
    provider: "openai.images",
    parameters: { size: "1024x1024" },
    content: [
      { type: "text", text: "a cabin" },
      { type: "image", source: { type: "url", url: "https://example.com/input.png" } },
    ],
  });
  assert.equal(message.content.filter((block) => block.type === "image").length, 1);
  assert.equal(message.meta.taskId, "task-1");
});

test("generation result messages preserve non-image URLs in the JSON result", () => {
  const message = buildGenerationResultMessage({
    taskId: "task-2",
    model: "video-model",
    parameters: { duration: 8 },
    status: "completed",
    result: [{ type: "video", source: { type: "url", url: "https://example.com/output.mp4" } }],
  });

  const text = message.content.find((block) => block.type === "text");
  assert.ok(text && text.type === "text");
  const parsed = JSON.parse(text.text) as { result: Array<{ type: string; source: { url: string } }> };
  assert.equal(parsed.result[0]?.type, "video");
  assert.equal(parsed.result[0]?.source.url, "https://example.com/output.mp4");
  assert.equal(message.content.filter((block) => block.type === "image").length, 0);
});
