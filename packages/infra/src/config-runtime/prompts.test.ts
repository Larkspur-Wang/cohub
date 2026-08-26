import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isPromptTemplate,
  isPromptTemplatesConfig,
  parsePromptFrontmatter,
  parsePromptTemplateFromText,
} from "./prompts.js";

test("parsePromptFrontmatter extracts attributes and body", () => {
  const parsed = parsePromptFrontmatter(
    "---\ndescription: demo\ncategory: debug\n---\nBody line",
  );
  assert.equal(parsed.attributes.description, "demo");
  assert.equal(parsed.attributes.category, "debug");
  assert.equal(parsed.body, "Body line");
});

test("parsePromptFrontmatter returns raw markdown without frontmatter", () => {
  const parsed = parsePromptFrontmatter("Just text");
  assert.deepEqual(parsed.attributes, {});
  assert.equal(parsed.body, "Just text");
});

test("parsePromptTemplateFromText parses quick-action, button-label and order", () => {
  const template = parsePromptTemplateFromText(
    '---\ndescription: Run diagnostics\nquick-action: true\nbutton-label: "Run Diag"\norder: 5\n---\nDo the thing',
    "/space/.agents/prompts/diag.md",
    "project",
  );
  assert.equal(template.name, "diag");
  assert.equal(template.quickAction, true);
  assert.equal(template.buttonLabel, "Run Diag");
  assert.equal(template.order, 5);
  assert.equal(template.content, "Do the thing");
});

test("parsePromptTemplateFromText keeps quickAction unset for normal prompts", () => {
  const template = parsePromptTemplateFromText(
    "---\ndescription: Plain\n---\nBody",
    "/space/.agents/prompts/plain.md",
    "platform",
  );
  assert.equal(template.quickAction, undefined);
  assert.equal(template.buttonLabel, undefined);
  assert.equal(template.order, undefined);
});

test("parsePromptTemplateFromText normalizes quick-action truthy and falsy spellings", () => {
  const truthy = parsePromptTemplateFromText(
    "---\nquick-action: yes\n---\nBody",
    "/space/.agents/prompts/a.md",
    "user",
  );
  assert.equal(truthy.quickAction, true);

  const falsy = parsePromptTemplateFromText(
    "---\nquick-action: false\n---\nBody",
    "/space/.agents/prompts/b.md",
    "user",
  );
  assert.equal(falsy.quickAction, undefined);

  const camel = parsePromptTemplateFromText(
    "---\nquickAction: true\n---\nBody",
    "/space/.agents/prompts/c.md",
    "user",
  );
  assert.equal(camel.quickAction, true);

  const invalid = parsePromptTemplateFromText(
    "---\nquick-action: maybe\n---\nBody",
    "/space/.agents/prompts/d.md",
    "user",
  );
  assert.equal(invalid.quickAction, undefined);
});

test("isPromptTemplate validates quick action fields", () => {
  assert.equal(
    isPromptTemplate({
      name: "a",
      description: "b",
      content: "c",
      filePath: "d",
      scope: "project",
      quickAction: true,
      buttonLabel: "A",
      order: 1,
    }),
    true,
  );
  assert.equal(
    isPromptTemplate({
      name: "a",
      description: "b",
      content: "c",
      filePath: "d",
      scope: "project",
      quickAction: "true",
    }),
    false,
  );
  assert.equal(
    isPromptTemplate({
      name: "a",
      description: "b",
      content: "c",
      filePath: "d",
      scope: "project",
      order: "1",
    }),
    false,
  );
});

test("isPromptTemplatesConfig accepts legacy entries without quick action fields", () => {
  assert.equal(
    isPromptTemplatesConfig({
      templates: [
        {
          name: "a",
          description: "b",
          content: "c",
          filePath: "d",
          scope: "platform",
        },
      ],
    }),
    true,
  );
});
