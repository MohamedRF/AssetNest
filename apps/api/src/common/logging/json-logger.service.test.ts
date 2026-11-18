import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { JsonLoggerService, type JsonLogEntry } from './json-logger.service.js';

function captureStream(): { stream: Writable; lines: string[] } {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      lines.push(chunk.toString('utf8').trim());
      callback();
    },
  });
  return { stream, lines };
}

function parseEntries(lines: string[]): JsonLogEntry[] {
  return lines.filter(Boolean).map((line) => JSON.parse(line) as JsonLogEntry);
}

describe('JsonLoggerService', () => {
  it('writes single-line JSON with level, msg and context', () => {
    const out = captureStream();
    const err = captureStream();
    const logger = new JsonLoggerService('TestCtx', 'info', out.stream, err.stream);
    logger.log('hello world');
    const entries = parseEntries(out.lines);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.level).toBe('info');
    expect(entries[0]?.msg).toBe('hello world');
    expect(entries[0]?.context).toBe('TestCtx');
    expect(entries[0]?.time).toBeDefined();
    expect(entries[0]?.requestId).toBeUndefined(); // outside request scope
  });

  it('suppresses debug output below the configured minimum level', () => {
    const out = captureStream();
    const err = captureStream();
    const logger = new JsonLoggerService('TestCtx', 'info', out.stream, err.stream);
    logger.debug('hidden');
    expect(parseEntries(out.lines)).toHaveLength(0);
    const devLogger = new JsonLoggerService('TestCtx', 'debug', out.stream, err.stream);
    devLogger.debug('visible');
    expect(parseEntries(out.lines).at(-1)?.msg).toBe('visible');
  });

  it('sends error entries to the error stream with serialized err', () => {
    const out = captureStream();
    const err = captureStream();
    const logger = new JsonLoggerService('TestCtx', 'info', out.stream, err.stream);
    logger.error('boom', new Error('kaput'), 'MyContext');
    expect(parseEntries(out.lines)).toHaveLength(0);
    const entries = parseEntries(err.lines);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.msg).toBe('boom');
    expect(entries[0]?.context).toBe('MyContext'); // trailing string overrides context
    expect(entries[0]?.err?.message).toBe('kaput');
    expect(entries[0]?.err?.name).toBe('Error');
  });

  it('merges a trailing object param as metadata', () => {
    const out = captureStream();
    const err = captureStream();
    const logger = new JsonLoggerService('TestCtx', 'info', out.stream, err.stream);
    logger.log('with meta', { route: '/health/live', attempt: 1 });
    const entries = parseEntries(out.lines);
    expect(entries[0]?.route).toBe('/health/live');
    expect(entries[0]?.attempt).toBe(1);
  });

  it('never throws on unserializable metadata', () => {
    const out = captureStream();
    const err = captureStream();
    const logger = new JsonLoggerService('TestCtx', 'info', out.stream, err.stream);
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => logger.log('circular', circular)).not.toThrow();
  });
});
