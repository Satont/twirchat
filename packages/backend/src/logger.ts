/**
 * Lightweight structured logger.
 *
 * Dev  (NODE_ENV !== "production"): colourful human-readable output
 * Prod (NODE_ENV === "production"):  newline-delimited JSON
 *
 * Usage:
 *   import { logger } from "./logger.ts";
 *   const log = logger("module-name");
 *   log.info("Server started", { port: 3000 });
 *   log.warn("Token expiring soon");
 *   log.error("Fetch failed", { status: 500 });
 *   log.debug("Raw IRC line", { line });
 */

const isProd = process.env.NODE_ENV === "production";

// ANSI colour helpers (only used in dev)
const c = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  // levels
  debug: "\x1b[36m",   // cyan
  info:  "\x1b[32m",   // green
  warn:  "\x1b[33m",   // yellow
  error: "\x1b[31m",   // red
  // misc
  gray:  "\x1b[90m",
  white: "\x1b[97m",
  module: "\x1b[35m",  // magenta
} as const;

type Level = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<Level, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const MIN_LEVEL: Level = (process.env.LOG_LEVEL as Level | undefined) ?? (isProd ? "info" : "debug");

function shouldLog(level: Level): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[MIN_LEVEL];
}

function formatDevLine(module: string, level: Level, msg: string, meta?: Record<string, unknown>): string {
  const now = new Date();
  const time = now.toTimeString().slice(0, 8); // HH:MM:SS

  const levelColor = c[level];
  const levelTag = `${levelColor}${c.bold}${level.toUpperCase().padEnd(5)}${c.reset}`;
  const timeStr = `${c.gray}${time}${c.reset}`;
  const moduleStr = `${c.module}[${module}]${c.reset}`;
  const msgStr = level === "error"
    ? `${c.error}${msg}${c.reset}`
    : level === "warn"
    ? `${c.warn}${msg}${c.reset}`
    : `${c.white}${msg}${c.reset}`;

  let line = `${timeStr} ${levelTag} ${moduleStr} ${msgStr}`;

  if (meta && Object.keys(meta).length > 0) {
    const metaStr = Object.entries(meta)
      .map(([k, v]) => {
        const val = typeof v === "object" ? JSON.stringify(v) : String(v);
        return `${c.dim}${k}${c.reset}=${c.cyan ?? c.debug}${val}${c.reset}`;
      })
      .join(" ");
    line += `  ${metaStr}`;
  }

  return line;
}

function formatProdLine(module: string, level: Level, msg: string, meta?: Record<string, unknown>): string {
  return JSON.stringify({
    ts: new Date().toISOString(),
    level,
    module,
    msg,
    ...meta,
  });
}

function emit(module: string, level: Level, msg: string, meta?: Record<string, unknown>): void {
  if (!shouldLog(level)) return;

  const line = isProd
    ? formatProdLine(module, level, msg, meta)
    : formatDevLine(module, level, msg, meta);

  if (level === "error") {
    process.stderr.write(line + "\n");
  } else {
    process.stdout.write(line + "\n");
  }
}

export interface Logger {
  debug(msg: string, meta?: Record<string, unknown>): void;
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}

export function logger(module: string): Logger {
  return {
    debug: (msg, meta) => emit(module, "debug", msg, meta),
    info:  (msg, meta) => emit(module, "info",  msg, meta),
    warn:  (msg, meta) => emit(module, "warn",  msg, meta),
    error: (msg, meta) => emit(module, "error", msg, meta),
  };
}
