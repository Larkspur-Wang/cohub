---
"@neta-art/cohub-cli": patch
---

Process-group cleanup treats EPERM on an emptied group as the normal end state on every platform, probes Windows trees through leader liveness, backs off snapshot polling, and never lets a cleanup failure mask a finished native result. A completed native Turn whose receipt was lost is rebuilt from native bytes on recovery, and serve-path archive uploads resume through the Space transport again.

进程组清理在所有平台将空组的 EPERM 视为正常终态，Windows 通过组长存活性确认进程树，轮询快照退避，且清理失败不再掩盖已完成的原生结果；回执丢失但原生侧已完成的 Turn 会从原生字节重建结果，serve 路径的归档上传恢复经由 Space 传输层落地。
