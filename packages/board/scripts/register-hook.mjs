/** Registers the source-resolution hook used by `node --test`. */
import { register } from "node:module";

register("./resolve-hook.mjs", import.meta.url);
