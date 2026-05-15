import { defineConfig } from "tsdown";

const entry = {
  index: "src/index.ts",
  http: "src/http.ts",
  websocket: "src/websocket.ts",
};

export default defineConfig({
  entry,
  format: "esm",
  dts: true,
  clean: true,
  target: "es2022",
  fixedExtension: false,
  hash: false,
  deps: {
    onlyBundle: false,
  },
  outExtensions: () => ({
    js: ".js",
    dts: ".d.ts",
  }),
  outputOptions: {
    chunkFileNames: "chunks/[name].js",
  },
  copy: ["README.md"],
});
