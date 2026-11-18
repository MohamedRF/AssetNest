import type { Writable } from 'node:stream';
import type { LoggerService, LogLevel as NestLogLevel } from '@nestjs/common';
import { CorrelationContext } from '../correlation.middleware.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export interface JsonLogEntry {
  time: string;
  level: LogLevel;
  msg: string;
  context?: string;
  requestId?: string;
  err?: { name: string; message: string; stack?: string };
  [key: string]: unknown;
}

/**
 * Minimal, dependency-free structured logger. Writes one single-line JSON
 * object per entry to stdout (stderr for errors). Honors the AsyncLocalStorage
 * correlation context set by correlationMiddleware and never logs request
 * headers, tokens or other secret material — callers must pass only safe data.
 *
 * NestJS LoggerService-compatible so it can be passed to NestFactory /
 * app.useLogger and injected anywhere.
 */
export class JsonLoggerService implements LoggerService {
  private minLevel: LogLevel;

  constructor(
    private readonly context?: string,
    minLevel: LogLevel = process.env.NODE_ENV === 'development' ? 'debug' : 'info',
    private readonly out: Writable = process.stdout,
    private readonly errOut: Writable = process.stderr,
  ) {
    this.minLevel = minLevel;
  }

  log(message: unknown, ...optionalParams: unknown[]): void {
    this.write('info', message, optionalParams);
  }

  error(message: unknown, ...optionalParams: unknown[]): void {
    this.write('error', message, optionalParams);
  }

  warn(message: unknown, ...optionalParams: unknown[]): void {
    this.write('warn', message, optionalParams);
  }

  debug(message: unknown, ...optionalParams: unknown[]): void {
    this.write('debug', message, optionalParams);
  }

  verbose(message: unknown, ...optionalParams: unknown[]): void {
    this.write('debug', message, optionalParams);
  }

  fatal(message: unknown, ...optionalParams: unknown[]): void {
    this.write('error', message, optionalParams);
  }

  setLogLevels(levels: NestLogLevel[]): void {
    // NestJS calls this at bootstrap. Map its levels onto our severity ladder,
    // picking the most verbose requested level (falling back to current default).
    const map: Record<NestLogLevel, LogLevel | undefined> = {
      log: 'info',
      error: 'error',
      warn: 'warn',
      debug: 'debug',
      verbose: 'debug',
      fatal: 'error',
    };
    const mapped = (Array.isArray(levels) ? levels : [])
      .map((level) => map[level])
      .filter((level): level is LogLevel => level !== undefined);
    if (mapped.includes('debug')) this.minLevel = 'debug';
    else if (mapped.includes('info')) this.minLevel = 'info';
    else if (mapped.includes('warn')) this.minLevel = 'warn';
    else if (mapped.includes('error')) this.minLevel = 'error';
  }

  private write(level: LogLevel, message: unknown, optionalParams: unknown[]): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[this.minLevel]) {
      return;
    }
    const entry = this.buildEntry(level, message, optionalParams);
    let line: string;
    try {
      line = JSON.stringify(entry);
    } catch {
      // Metadata contained unserializable values (e.g. circular refs).
      line = JSON.stringify({
        time: entry.time,
        level: entry.level,
        msg: entry.msg,
        context: entry.context,
        serializationError: true,
      });
    }
    const target = level === 'error' ? this.errOut : this.out;
    target.write(`${line}\n`);
  }

  private buildEntry(level: LogLevel, message: unknown, optionalParams: unknown[]): JsonLogEntry {
    // NestJS convention: a trailing string argument is the "context" (class name).
    let context = this.context;
    const extra = [...optionalParams];
    const last = extra[extra.length - 1];
    if (extra.length > 0 && typeof last === 'string') {
      context = last;
      extra.pop();
    }

    const entry: JsonLogEntry = {
      time: new Date().toISOString(),
      level,
      msg: this.serializeMessage(message),
    };
    if (context) {
      entry.context = context;
    }
    const requestId = CorrelationContext.getRequestId();
    if (requestId) {
      entry.requestId = requestId;
    }

    const err = message instanceof Error ? message : this.findError(extra);
    if (err) {
      entry.err = { name: err.name, message: err.message, stack: err.stack };
    }

    const reserved = new Set(['requestId', 'level', 'msg', 'time', 'context']);
    const metadata = extra.filter((p) => !(p instanceof Error));
    if (metadata.length === 1 && metadata[0] && typeof metadata[0] === 'object') {
      for (const [key, value] of Object.entries(metadata[0] as Record<string, unknown>)) {
        if (!reserved.has(key)) {
          entry[key] = value;
        }
      }
    } else if (metadata.length > 0) {
      entry.meta = metadata.map((m) => this.serializeMessage(m));
    }
    return entry;
  }

  private findError(params: unknown[]): Error | undefined {
    for (const param of params) {
      if (param instanceof Error) {
        return param;
      }
    }
    return undefined;
  }

  private serializeMessage(message: unknown): string {
    if (typeof message === 'string') {
      return message;
    }
    if (message instanceof Error) {
      return message.message;
    }
    try {
      return JSON.stringify(message) ?? String(message);
    } catch {
      return String(message);
    }
  }
}

/** Convenience for fatal bootstrap errors before Nest (and DI) are up. */
export function writeFatalBootstrapError(error: unknown): void {
  const payload: JsonLogEntry = {
    time: new Date().toISOString(),
    level: 'error',
    msg: error instanceof Error ? error.message : String(error),
    context: 'Bootstrap',
  };
  if (error instanceof Error && error.stack) {
    payload.err = { name: error.name, message: error.message, stack: error.stack };
  }
  process.stderr.write(`${JSON.stringify(payload)}\n`);
}
