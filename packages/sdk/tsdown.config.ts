import { defineConfig } from "tsdown";

const entry = {
  index: "src/index.ts",
  http: "src/http.ts",
  websocket: "src/websocket.ts",
  "voice-input": "src/voice-input.ts",
  debugger: "src/debugger.ts",
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
});
