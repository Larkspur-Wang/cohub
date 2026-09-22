---
"@neta-art/cohub-cli": patch
---

Fix diagnostics URL redaction: healthy URLs stay byte-identical instead of being re-encoded (the trailing `"` from wrapped log lines no longer becomes `%22`), and the matcher no longer swallows quotes or angle brackets. Bilingual summary: 修复诊断日志的 URL 脱敏——无敏感参数的 URL 保持原样（不再把日志换行携带的 `"` 重编码成 `%22`），匹配也不再吞掉引号与尖括号。
