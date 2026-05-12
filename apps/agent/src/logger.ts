type LogLevel = "silent" | "error" | "warn" | "info" | "debug" | "trace";

const LEVELS: Record<LogLevel, number> = {
  silent: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
  trace: 5,
};

function normalizeLogLevel(value: string | undefined): LogLevel {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "silent" || normalized === "error" || normalized === "warn" || normalized === "info" || normalized === "debug" || normalized === "trace") {
    return normalized;
  }
  if (process.env.DEBUG_AGENT === "1") return "debug";
  return "info";
}

const currentLevel = normalizeLogLevel(process.env.LOG_LEVEL);

function enabled(level: LogLevel) {
  return LEVELS[currentLevel] >= LEVELS[level];
}

export const logger = {
  get level() {
    return currentLevel;
  },
  isDebugEnabled() {
    return enabled("debug");
  },
  isTraceEnabled() {
    return enabled("trace");
  },
  error(...args: unknown[]) {
    if (enabled("error")) console.error(...args);
  },
  warn(...args: unknown[]) {
    if (enabled("warn")) console.warn(...args);
  },
  info(...args: unknown[]) {
    if (enabled("info")) console.log(...args);
  },
  debug(...args: unknown[]) {
    if (enabled("debug")) console.log(...args);
  },
  trace(...args: unknown[]) {
    if (enabled("trace")) console.log(...args);
  },
};
