---
"@neta-art/cohub": minor
---

Space FS reads, stat, and ls results now expose file metadata change time as `ctimeMs` (epoch milliseconds, when available), and stat reports `isFile`. SDK `SpaceFsFileResponse` gains the matching optional `ctimeMs` field.
