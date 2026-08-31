---
"@cohub/api": patch
"@cohub/gateway": patch
"web": patch
---

Fix all production Dependabot audit alerts: bump hono to 4.12.34, @hono/node-server to 2.0.10, pdfjs-dist to 6.2.108 (XSS via malicious PDF), wrangler to 4.127.1; refresh lockfile to pick up patched transitive deps (undici, js-yaml, form-data, ip-address, mermaid, dompurify, protobufjs, postcss, nanoid, @opentelemetry/core)
