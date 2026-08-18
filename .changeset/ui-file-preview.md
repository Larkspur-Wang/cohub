---
"@neta-art/cohub-cli": minor
"@neta-art/cohub": minor
---

Support Space file previews from the CLI: `cohub ui preview` accepts `file://<path>` or a relative Space path (resolved against the active space), alongside the existing Work refs and the new `work://` scheme. The SDK now exports `UiFilePreviewTarget` for the extended `preview.show` command.
