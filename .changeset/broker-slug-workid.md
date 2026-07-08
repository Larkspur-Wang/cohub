---
"@neta-art/cohub": minor
---

Broker mode can now resolve the workId at runtime from the public slug triple. Standalone Works no longer need to hardcode a workId that only exists after publishing — pass `work: { brokerOrigin, ownerUsername, spaceSlug, workSlug }` and the SDK reverse-looks-up the workId via the anonymous `works.getBySlug` API, caches it, and starts broker mode. Explicit `workId` still takes precedence, and bridge mode (inside the Cohub iframe) is unaffected.
