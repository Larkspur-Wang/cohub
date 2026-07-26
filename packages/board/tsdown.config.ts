import { defineConfig } from "tsdown";

const entry = {
  index: "src/index.ts",
  "export/index": "src/export/index.ts",
  "export/headless": "src/export/headless.ts",
};

export default defineConfig({
  entry,
  format: "esm",
  // Resolve @cohub/protocol via package exports (dist) so the emitted d.ts stays
  // inside rootDir. It is private, so it is inlined; zod and pixi.js stay
  // external because they are declared dependencies of this package.
  tsconfig: "tsconfig.build.json",
  dts: true,
  clean: true,
  target: "es2022",
  fixedExtension: false,
  hash: false,
  outExtensions: () => ({
    js: ".js",
    dts: ".d.ts",
  }),
  outputOptions: {
    chunkFileNames: "chunks/[name].js",
  },
});
