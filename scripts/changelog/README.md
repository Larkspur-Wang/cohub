# Changelog Generation

Automated changelog generation powered by Cohub agents analyzing actual git diffs.

## Structure

```
apps/web/src/lib/changelog/
  entries.json              # Single source of truth
  index.ts                  # Type-safe exports

scripts/changelog/
  shared.ts                 # Types & I/O helpers
  generate.ts               # Agent-powered entry generation
  render.ts                 # Render to CHANGELOG.md or tag message
  release.ts                # Orchestrate: generate → render → commit → tag

CHANGELOG.md                # Generated, do not edit manually
```

## Usage

### Generate a single entry

```bash
pnpm changelog:generate --from v1.97.1 --to v1.98.0
```

Sends the tag range to a Cohub agent (via `cohub spaces prompt`), which:
- Runs `git diff` and `git diff --stat` to analyze actual changes
- Writes a structured entry focused on user/developer-facing changes and technical architecture
- Auto-retries up to 3 times on validation errors
- Saves failed attempts to `.changelog-draft/` for manual recovery

### Backfill historical entries

```bash
pnpm changelog:generate --from v1.85.2 --to v1.86.0
pnpm changelog:generate --from v1.86.0 --to v1.87.0
# ... etc
```

Each run appends to `entries.json`. If the same minor version already exists, the new entry **replaces** the existing highlights and fixes, and merges the tag list.

### Render CHANGELOG.md

```bash
pnpm changelog:render
```

Generates the root `CHANGELOG.md` from `entries.json`. Always regenerates the entire file.

### Release a new version (recommended workflow)

```bash
pnpm changelog:release v1.99.0
```

Orchestrates:
1. Checks working tree is clean, tag doesn't exist
2. Runs `generate.ts` for `<prevTag>..HEAD`
3. Renders `CHANGELOG.md`
4. Commits both files: `docs: changelog for v1.99.0`
5. Creates annotated git tag with the entry as the tag message

Then push:
```bash
git push && git push origin v1.99.0
```

## Requirements

- `cohub` CLI installed globally: `npm install -g @neta-art/cohub-cli`
- Clean working directory for `changelog:release`

## Data Format

```ts
interface ChangelogEntry {
  version: string;       // "1.87" (minor version)
  date: string;          // "2026-07-08" (ISO date)
  tags: string[];        // ["v1.87.0"] (git tags)
  highlights: string[];  // 2-5 user-facing changes
  fixes?: string[];      // Optional bug fixes
}
```

Highlights and fixes support inline markdown: `**bold**` and `` `code` ``.

## Guidelines

The agent is prompted to:
- Prioritize user/developer-facing features, UX improvements, performance wins
- **Include significant refactors, architecture changes, and stack upgrades** (important for technical brand)
- Group related commits into one highlight
- Lead key items with bold noun phrases: `**Feature name**: description`
- Exclude: dependency bumps, typos, CI tweaks (unless they enable something)

## Troubleshooting

**Agent times out or produces invalid JSON:**
Check `.changelog-draft/<tag>.md` for the raw response, fix manually, and add to `entries.json`.

**Tag already exists:**
Use `generate.ts` directly to backfill, or delete the tag and re-run `release.ts`.

**No cohub CLI:**
Install it: `npm install -g @neta-art/cohub-cli`
