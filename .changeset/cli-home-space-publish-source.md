---
"@neta-art/cohub-cli": minor
"@neta-art/cohub": patch
---

CLI commands now fall back to the Home space when `-s` / `COHUB_SPACE_ID` are omitted (`GET /api/spaces/default`, cached per login). `apps publish` infers `--source` from runtime (workspace in a sandbox, local otherwise). `getCohubContext()` treats runtime as sandbox only when an execution token is present.
