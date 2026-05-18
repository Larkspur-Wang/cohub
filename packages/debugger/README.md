# @cohub/debugger

Browser-side rolling debugger that captures console calls, fetch/XHR traffic, EventSource messages, and WebSocket frames.

```ts
import { exportCohubDebugLog, startCohubDebugger } from "@cohub/debugger";

startCohubDebugger();

// Later, for a support ticket or bug report:
const logPackage = exportCohubDebugLog();
```

Call `startCohubDebugger()` as early as possible during application startup so the rolling buffers include the full user journey.
