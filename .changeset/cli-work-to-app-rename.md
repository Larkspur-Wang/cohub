---
"@neta-art/cohub-cli": major
---

Rename the Work commands to App/Desktop vocabulary in the CLI.

**Breaking changes**

- `cohub apps` is the canonical command for managing published Apps (replacing `cohub works`).
- `cohub desktop open` is the canonical command for opening a surface/tab (replacing `cohub ui preview`).

**Compatibility**

- `cohub works` and `cohub ui preview` remain as deprecated aliases, so existing scripts and muscle-memory keep working until the next breaking release.
- The CLI now reads and writes the canonical App wire vocabulary end to end.
