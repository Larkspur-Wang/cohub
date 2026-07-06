---
"@neta-art/cohub": minor
---

Ship pending SDK changes accumulated since 2.2.1 that the CLI already
consumes (references, label patching) and must release together.

- **feat: resource reference index** — add `ReferencesApi` exposed as
  `cohub.references` on both `CohubClient` and `CohubHttpClient`. `query()`
  lists references touching a resource (space/session/checkpoint); `aggregate()`
  returns grouped counts for a space. Plus the full `Reference*` type set
  (`ReferenceQueryableType`, `ReferenceKind`, `ReferenceDirection`,
  `ReferenceAggregateGroupBy`, `ReferenceRecord`, …).
- **feat: incremental resource label patching** — add
  `SpaceLabelsApi.patchResourceLabels(resourceType, resourceRef, { addLabelRefs,
  removeLabelRefs })` returning `{ labels, assignments, changed }`, alongside the
  existing full `setResourceLabels`. Adds `PatchResourceLabelsInput` /
  `PatchResourceLabelsResponse` types.
- **feat: local sandbox provider** — add `SpaceSandboxProvider` (`"cloud" |
  "local"`) on `SpaceSandboxConfig` / `SpaceConfigInput` / `SpaceSandboxRecord`
  so spaces can declare a local sandbox provider.
- **feat: session auto-compact** — extend `CreateSpacePromptInput.intent` with
  `"compact"` for agent-driven context compaction.
- **fix: each_key_duplicate crash in generation stream** — merge intermediate
  messages that share a `tool_use.id` but landed under different dedupe keys
  (ordinal-keyed snapshot path vs id-keyed persisted-message path), as
  defense-in-depth for records lacking `meta.messageOrdinal`.
