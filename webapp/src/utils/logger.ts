/**
 * Production-ready logging utility for the RFS Fire Break Calculator.
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
const isDevelopment = import.meta.env.MODE === 'development';
export const logger = new Logger(isDevelopment ? LogLevel.DEBUG : LogLevel.WARN);