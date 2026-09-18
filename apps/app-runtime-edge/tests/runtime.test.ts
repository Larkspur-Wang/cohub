import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import vm from "node:vm";

for (const environment of ["dev", "prod"] as const) {
  describe(`${environment} browser runtime`, () => {
    it("creates an empty namespace and prints one styled banner per document", async () => {
      const source = await readFile(new URL(`../dist/runtime-${environment}.js`, import.meta.url), "utf8");
      const logs: unknown[][] = [];
      const window: { __cohub?: unknown } = {};
      const context = vm.createContext({ window, console: { log: (...args: unknown[]) => logs.push(args) } });
      vm.runInContext(source, context);
      const namespace = window.__cohub;
      assert.equal(typeof namespace, "object");
      assert.notEqual(namespace, null);
      assert.equal(Reflect.ownKeys(namespace as object).length, 0);
      vm.runInContext(source, context);
      assert.equal(window.__cohub, namespace);
      assert.equal(logs.length, 1);
      const banner = logs[0];
      assert.ok(banner);
      assert.match(String(banner[0]), /%c/);
      assert.match(String(banner[0]), /cohub/);
      assert.match(String(banner[0]), /runtime/);
      assert.match(String(banner[0]), new RegExp(environment, "i"));
    });

    it("preserves an existing namespace and its data", async () => {
      const source = await readFile(new URL(`../dist/runtime-${environment}.js`, import.meta.url), "utf8");
      const namespace = { existing: { version: 1 } };
      const logs: unknown[][] = [];
      const window = { __cohub: namespace };
      const context = vm.createContext({ window, console: { log: (...args: unknown[]) => logs.push(args) } });
      vm.runInContext(source, context);
      vm.runInContext(source, context);
      assert.equal(window.__cohub, namespace);
      assert.deepEqual(namespace, { existing: { version: 1 } });
      assert.equal(logs.length, 1);
    });
  });
}
