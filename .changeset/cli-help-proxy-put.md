---
"@neta-art/cohub-cli": patch
---

CLI help now resolves the command path before printing, so unknown prefixes like `cohub cli apps publish --help` error instead of dumping top-level help. Local uploads honor `http_proxy`/`https_proxy` via Node's `--use-env-proxy`, send `Content-Length`, and retry transient PUT failures.
