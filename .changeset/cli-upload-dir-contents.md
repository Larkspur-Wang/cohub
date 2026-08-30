---
"@neta-art/cohub-cli": minor
---

fix(cli): upload directory contents directly under --dir

`spaces files upload <dir> --dir <target>` used to nest the source
directory name under the target (`target/<dir>/...`). It now contributes
the directory's contents directly (`target/...`), matching common cloud
CLIs (`aws s3 cp dir`, `rclone copy`).
File arguments are unchanged. Inputs whose contents collide on the same
relative path now fail fast instead of silently overwriting.
