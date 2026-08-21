---
"@neta-art/cohub": major
"@neta-art/cohub-cli": major
---

Board semantic authoring protocol

**Breaking changes**

- Semantic mutations (`POST /boards/:id/mutations`) now accept `board.patch`, `connection.*`, `effect.*`, and `composition.*` commands alongside `item.*`; all commands compile into one atomic transaction.
- `POST /boards/:id/validate`, SDK `board.validate()`, CLI `cohub boards validate`/`apply` removed. Use semantic mutations with `dryRun: true` for server-side validation.
- SDK `boards.create()` and `board.authoring()` return the semantic `BoardAuthoringSnapshot` (items, connections, effects, compositions, playback); raw Board bootstrap/transaction methods were removed.
- `BoardSummary.counts.nodes` renamed to `counts.items`; `BoardCapabilities` exposes `items` instead of `nodes`.
- SDK realtime board event and subscription handler are now `board.changed` / `changed`, with semantic `changed` projection and no wire operations.
- CLI: `boards nodes add/patch/remove` replaced by `boards items create/patch/replace/delete`; `boards examples` and `boards capabilities` provide templates and schemas.

**New**

- `dryRun: true` on semantic mutations: full server-side validation (version, references, cascade) without writing or consuming the mutation id.
- Idempotent mutation replay via persisted receipts; no-op mutations record a `validated` receipt without bumping the board version.
- Composition re-apply is row-diffed: unchanged tracks/clips keep their rows, identical aggregates short-circuit to a no-op.
- Targeted reads for item, connection, effect and composition projections; section-scoped validation reads for mutations.
- `BoardEffectSchema` lives in one module (`board-effect.js`) shared by create and mutation paths.
- Web, CLI and SDK all use the same public `authoring()` / `mutateSemantic()` / `board.changed` path; pending Web edits persist semantic mutations.
- `item.reorder` expresses z-order without exposing storage `orderKey`; `effect.apply` is the idempotent declaration-style effect command.
- Mutation receipts expose `outcome: applied | noop | dry-run`; Board realtime uses the same semantic changed projection.
- Checkpoints and published Works store the same semantic Item snapshot as live authoring reads; legacy Sequence/Node snapshot compatibility was removed.
