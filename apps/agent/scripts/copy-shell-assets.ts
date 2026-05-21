import { cp, mkdir } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = resolve(root, "src");
const distDir = resolve(root, "dist");

async function main() {
  await mkdir(distDir, { recursive: true });
  const script = resolve(srcDir, "jobs/sandbox-bash/upload-files.sh");
  const target = resolve(distDir, "jobs/sandbox-bash/upload-files.sh");
  await mkdir(dirname(target), { recursive: true });
  await cp(script, target);
  console.log(`[copy-shell-assets] ${relative(root, script)} -> ${relative(root, target)}`);
}

main().catch((error) => {
  console.error("[copy-shell-assets] failed:", error);
  process.exit(1);
});
