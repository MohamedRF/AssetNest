import { describe, expect, it, vi } from 'vitest';
import { decodeAgUiEvent, parseSSEFrame, readAgUiStream } from './ag-ui-stream';

function streamFromChunks(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

const runStarted = `data: ${JSON.stringify({ type: 'RUN_STARTED', threadId: 't1', runId: 'r1' })}\n\n`;
const runError = `data: ${JSON.stringify({ type: 'RUN_ERROR', message: 'boom', code: 'X' })}\n\n`;

describe('parseSSEFrame', () => {
  it('extracts and joins data lines', () => {
    expect(parseSSEFrame('data: {"a":1}')).toBe('{"a":1}');
    expect(parseSSEFrame('data:{"a":1}')).toBe('{"a":1}');
    expect(parseSSEFrame('event: ping\ndata: line1\ndata: line2')).toBe('line1\nline2');
  });

  it('returns null when there are no data lines', () => {
    expect(parseSSEFrame('event: ping')).toBeNull();
    expect(parseSSEFrame(': keep-alive')).toBeNull();
  });
});

describe('decodeAgUiEvent', () => {
  it('rejects a text content event with an empty delta', () => {
    expect(() =>
      decodeAgUiEvent('data: {"type":"TEXT_MESSAGE_CONTENT","messageId":"m1","delta":""}'),
    ).toThrow();
  });

  it('parses a valid event', () => {
    const event = decodeAgUiEvent(runStarted.trim());
    expect(event).toEqual({ type: 'RUN_STARTED', threadId: 't1', runId: 'r1' });
  });

  it('throws on malformed JSON', () => {
    expect(() => decodeAgUiEvent('data: {not json')).toThrow();
  });

  it('throws on a schema violation', () => {
    // RUN_STARTED without the required runId.
    expect(() => decodeAgUiEvent('data: {"type":"RUN_STARTED","threadId":"t1"}')).toThrow();
  });
});

describe('readAgUiStream', () => {
  it('emits events in order across split chunk boundaries', async () => {
    const chunks = [
      'data: {"type":"RUN_STARTED","threadId":"t1","runId":"r1"}\n', // no boundary yet
      `\ndata: ${JSON.stringify({ type: 'STEP_STARTED', stepName: 's' })}\n\n`,
      runError,
    ];
    const seen: string[] = [];
    await readAgUiStream(streamFromChunks(chunks), (event) => seen.push(event.type));
    expect(seen).toEqual(['RUN_STARTED', 'STEP_STARTED', 'RUN_ERROR']);
  });

  it('ignores heartbeats and accepts split CRLF and CR framing', async () => {
    const chunks = [
      ': keep-alive\r',
      '\n\r\n' + runStarted.replace(/\n/g, '\r\n').slice(0, -1),
      '\n' + runError.replace(/\n/g, '\r'),
    ];
    const seen: string[] = [];
    await readAgUiStream(streamFromChunks(chunks), (event) => seen.push(event.type));
    expect(seen).toEqual(['RUN_STARTED', 'RUN_ERROR']);
  });

  it('discards a final frame without a trailing blank line', async () => {
    const onEvent = vi.fn();
    await readAgUiStream(streamFromChunks([runStarted.trimEnd() + '\n']), onEvent);
    expect(onEvent).not.toHaveBeenCalled();
  });

  it('cancels an open stream at the first terminal event without waiting for cancellation', async () => {
    const cancel = vi.fn(() => new Promise<void>(() => undefined));
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(runStarted + runError + 'data: invalid\n\n'));
      },
      cancel,
    });
    const seen: string[] = [];
    await readAgUiStream(stream, (event) => seen.push(event.type));
    expect(seen).toEqual(['RUN_STARTED', 'RUN_ERROR']);
    expect(cancel).toHaveBeenCalledOnce();
    expect(stream.locked).toBe(false);
  });

  it('rejects and cancels the stream when a frame fails validation', async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"type":"RUN_STARTED"}\n\n'));
      },
      cancel,
    });
    const onEvent = vi.fn();
    await expect(readAgUiStream(stream, onEvent)).rejects.toThrow();
    expect(onEvent).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledOnce();
  });
});
