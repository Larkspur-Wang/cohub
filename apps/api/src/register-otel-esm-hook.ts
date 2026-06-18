import { register } from "node:module";
import { pathToFileURL } from "node:url";

// import-in-the-middle's ESM hook is an async loader hook. Node's newer
// registerHooks() API only accepts synchronous hooks, so it cannot load the
// OpenTelemetry hook directly yet.
register("@opentelemetry/instrumentation/hook.mjs", pathToFileURL("./"));
