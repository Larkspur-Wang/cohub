import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const packageRoot = resolve(import.meta.dirname, "..");
const packageJsonPath = resolve(packageRoot, "package.json");
const distPackageJsonPath = resolve(packageRoot, "dist/package.json");

const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
packageJson.files = ["*.js", "*.d.ts", "chunks", "README.md"];

await mkdir(resolve(packageRoot, "dist"), { recursive: true });
await writeFile(distPackageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`);
