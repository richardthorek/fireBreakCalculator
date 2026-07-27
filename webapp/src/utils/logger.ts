/**
 * Production-ready logging utility for the Fire Break Calculator.
 * Provides different log levels and can be configured for production use.
 */

export enum LogLevel {
  ERROR = 0,
  WARN = 1,
  INFO = 2,
  DEBUG = 3
}

class Logger {
  private level: LogLevel;

  constructor(level: LogLevel = LogLevel.WARN) {
    this.level = level;
  }

  setLevel(level: LogLevel) {
    this.level = level;
  }

  error(message: string, ...args: any[]) {
    if (this.level >= LogLevel.ERROR) {
      console.error(`[ERROR] ${message}`, ...args);
    }
  }

  warn(message: string, ...args: any[]) {
    if (this.level >= LogLevel.WARN) {
      console.warn(`[WARN] ${message}`, ...args);
    }
  }

  info(message: string, ...args: any[]) {
    if (this.level >= LogLevel.INFO) {
      console.info(`[INFO] ${message}`, ...args);
    }
  }

  debug(message: string, ...args: any[]) {
    if (this.level >= LogLevel.DEBUG) {
      console.log(`[DEBUG] ${message}`, ...args);
    }
  }
}

// Create a default logger instance
// In production, this could be set to LogLevel.ERROR or LogLevel.WARN
//
// `import.meta.env` is undefined outside Vite (e.g. a terrain/*.ts module
// imported by a plain `npx tsx` test script, since several test-covered
// modules transitively import this file) — same guard already established
// in infrastructureService.ts for the identical reason.
const env = (import.meta as any).env ?? {};
const isDevelopment = env.MODE === 'development';
export const logger = new Logger(isDevelopment ? LogLevel.DEBUG : LogLevel.WARN);