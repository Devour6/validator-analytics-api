/**
 * Structured Logger
 * Provides consistent logging with context and levels
 */

export enum LogLevel {
  ERROR = 'error',
  WARN = 'warn',
  INFO = 'info',
  DEBUG = 'debug'
}

export interface LogContext {
  component?: string;
  operation?: string;
  voteAccount?: string;
  duration?: number;
  error?: Error;
  [key: string]: any;
}

class Logger {
  private serviceName: string;
  private logLevel: LogLevel;

  constructor(serviceName: string = 'validator-analytics-api') {
    this.serviceName = serviceName;
    this.logLevel = this.parseLogLevel(process.env.LOG_LEVEL) || LogLevel.INFO;
  }

  private parseLogLevel(level?: string): LogLevel | null {
    if (!level) return null;
    
    const normalized = level.toLowerCase();
    if (Object.values(LogLevel).includes(normalized as LogLevel)) {
      return normalized as LogLevel;
    }
    return null;
  }

  private shouldLog(level: LogLevel): boolean {
    const levels = [LogLevel.ERROR, LogLevel.WARN, LogLevel.INFO, LogLevel.DEBUG];
    return levels.indexOf(level) <= levels.indexOf(this.logLevel);
  }

  private formatMessage(level: LogLevel, message: string, context?: LogContext): string {
    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      level,
      service: this.serviceName,
      message,
      ...(context || {})
    };

    // If error exists, serialize it properly
    if (context?.error) {
      logEntry.error = {
        message: context.error.message,
        stack: context.error.stack,
        name: context.error.name
      };
    }

    return JSON.stringify(logEntry);
  }

  error(message: string, context?: LogContext): void {
    if (this.shouldLog(LogLevel.ERROR)) {
      console.error(this.formatMessage(LogLevel.ERROR, message, context));
    }
  }

  warn(message: string, context?: LogContext): void {
    if (this.shouldLog(LogLevel.WARN)) {
      console.warn(this.formatMessage(LogLevel.WARN, message, context));
    }
  }

  info(message: string, context?: LogContext): void {
    if (this.shouldLog(LogLevel.INFO)) {
      console.log(this.formatMessage(LogLevel.INFO, message, context));
    }
  }

  debug(message: string, context?: LogContext): void {
    if (this.shouldLog(LogLevel.DEBUG)) {
      console.log(this.formatMessage(LogLevel.DEBUG, message, context));
    }
  }
}

// Export singleton instance
export const logger = new Logger();