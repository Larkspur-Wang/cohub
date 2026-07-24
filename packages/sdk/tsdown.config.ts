import { defineConfig } from "tsdown";

const entry = {
  index: "src/index.ts",
  http: "src/http.ts",
  websocket: "src/websocket.ts",
  "voice-input": "src/voice-input.ts",
  debugger: "src/debugger.ts",
  board: "src/board.ts",
};

export default defineConfig({
  entry,
  format: "esm",
  // Resolve @cohub/protocol via package exports (dist) so TS7 native dts emit stays inside rootDir.
  // Dev typecheck still uses tsconfig.json path aliases to protocol source.
  tsconfig: "tsconfig.build.json",
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
