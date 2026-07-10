/**
 * Shared checkpoint ignore rules used by:
 * - worker save scan
 * - API pending-diff preview
 *
 * Keep this list in sync for both paths so "Review changes" matches what save will include.
 */

/** Hard excludes always applied (even if a user .gitignore tries to re-include). */
export const CHECKPOINT_HARD_EXCLUDES = [
  ".git/",
  "**/.git/",
  ".cohub/system/",
  "**/.cohub/system/",
] as const;

/**
 * Platform-level ignore patterns (gitignore syntax).
 * Mirrors historical worker PLATFORM_IGNORE.
 */
export const CHECKPOINT_PLATFORM_IGNORE = `
node_modules/
**/node_modules/
.pnpm-store/
**/.pnpm-store/
.yarn/cache/
**/.yarn/cache/
.yarn/unplugged/
**/.yarn/unplugged/
.yarn/build-state.yml
**/.yarn/build-state.yml
.yarn/install-state.gz
**/.yarn/install-state.gz
.npm/
**/.npm/
dist/
**/dist/
build/
**/build/
.next/
**/.next/
.nuxt/
**/.nuxt/
.svelte-kit/
**/.svelte-kit/
.turbo/
**/.turbo/
.vercel/output/
**/.vercel/output/
.cache/
**/.cache/
.parcel-cache/
**/.parcel-cache/
vite.config.*.timestamp-*
**/vite.config.*.timestamp-*
tsconfig.tsbuildinfo
**/tsconfig.tsbuildinfo
coverage/
**/coverage/
.playwright/
**/.playwright/
test-results/
**/test-results/
*.log
**/*.log
npm-debug.log*
**/npm-debug.log*
yarn-debug.log*
**/yarn-debug.log*
pnpm-debug.log*
**/pnpm-debug.log*
.DS_Store
**/.DS_Store
Thumbs.db
**/Thumbs.db
`.trim();

/** Combined platform + hard excludes as gitignore body (for `ignore` package). */
export function checkpointSystemIgnoreBody(): string {
  return [...CHECKPOINT_HARD_EXCLUDES, CHECKPOINT_PLATFORM_IGNORE].join("\n");
}
