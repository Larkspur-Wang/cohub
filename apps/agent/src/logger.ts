import { createLogger } from "@cohub/infra/logging";
type LogLevel = "silent" | "error" | "warn" | "info" | "debug" | "trace";

const appLogger = createLogger({ serviceName: "cohub-agent", defaultLevel: process.env.DEBUG_AGENT === "1" ? "debug" : "info" });


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
  error(message: unknown, ...args: unknown[]) {
    if (enabled("error")) appLogger.error(message, ...args);
  },
  warn(message: unknown, ...args: unknown[]) {
    if (enabled("warn")) appLogger.warn(message, ...args);
  },
  info(message: unknown, ...args: unknown[]) {
    if (enabled("info")) appLogger.info(message, ...args);
  },
  debug(message: unknown, ...args: unknown[]) {
    if (enabled("debug")) appLogger.debug(message, ...args);
  },
  trace(message: unknown, ...args: unknown[]) {
    if (enabled("trace")) appLogger.trace(message, ...args);
  },
};
