import assert from "node:assert/strict";
import { test } from "node:test";
import type { ContentBlock } from "@cohub/protocol/core";
import { deriveSessionFallbackTitle, shouldGenerateSessionTitle } from "./session-title.js";

const image: ContentBlock = {
  type: "image",
  source: { type: "url", url: "https://example.com/image.png" },
};

test("derives a normalized fallback title from message text", () => {
  assert.equal(deriveSessionFallbackTitle({
    content: [{ type: "text", text: "  Plan   the release  " }],
  }), "Plan the release");
});

test("unwraps generation request content", () => {
  const content: ContentBlock[] = [{
    type: "text",
    text: JSON.stringify({
      type: "generation.request",
      content: [{ type: "text", text: "Create a product mockup" }, image],
    }),
  }];
  assert.equal(deriveSessionFallbackTitle({ content, generationRequest: true }), "Create a product mockup");
});

test("uses an image fallback when no text is available", () => {
  assert.equal(deriveSessionFallbackTitle({ content: [image] }), "Image");
});

test("uses the original direct shell command as a deterministic title", () => {
  const content: ContentBlock[] = [{
    type: "shell_command",
    command: " git status  ",
    rawText: "! git status  ",
  }];
  assert.equal(deriveSessionFallbackTitle({ content }), "! git status");
  assert.equal(shouldGenerateSessionTitle({ content }), false);
});

test("only generates titles for model-supported content", () => {
  assert.equal(shouldGenerateSessionTitle({ content: [{ type: "text", text: "Plan the release" }] }), true);
  assert.equal(shouldGenerateSessionTitle({ content: [image] }), true);
  assert.equal(shouldGenerateSessionTitle({ content: [{ type: "text", text: "  " }] }), false);
});

test("fails open for malformed message content", () => {
  for (const content of [
    [null],
    [{}],
    [{ type: "text" }],
    [{ type: "shell_command", command: "pwd" }],
    [{ type: "shell_command", command: "", rawText: "!" }],
  ]) {
    assert.equal(deriveSessionFallbackTitle({
      content: content as unknown as ContentBlock[],
    }), null);
  }
});

test("fails open for malformed generation request content", () => {
  for (const nested of [[null], [{}], [{ type: "image", source: null }]]) {
    const content: ContentBlock[] = [{
      type: "text",
      text: JSON.stringify({ type: "generation.request", content: nested }),
    }];
    assert.equal(deriveSessionFallbackTitle({ content, generationRequest: true }), null);
  }
});
