/**
 * Typed reader for an AG-UI server-sent event stream.
 *
 * AG-UI over HTTP uses the standard SSE framing (see the official
 * `@ag-ui/client` `parseSSEStream`): events are separated by a blank line,
 * and each event's JSON payload is carried on `data:` lines. The
 * JSON object's `type` is the protocol `EventType` wire value.
 *
 * This reader:
 *  - decodes a byte stream incrementally (UTF-8 safe across chunk boundaries),
 *  - accepts LF, CRLF, and CR line endings across chunk boundaries,
 *  - validates every parsed event against the shared AG-UI schema
 *    (`@assetnest/contracts`) so malformed/unexpected frames fail loudly
 *    instead of being rendered,
 *  - invokes `onEvent` in arrival order through the first terminal event.
 */

import { agUiEventSchema, type AgUiEvent } from '@assetnest/contracts';

/** Extract the JSON payload from one raw SSE frame (the `data:` lines). */
export function parseSSEFrame(frame: string): string | null {
  const dataLines: string[] = [];
  for (const line of frame.split(/\r\n|\r|\n/)) {
    if (line === 'data') {
      dataLines.push('');
    } else if (line.startsWith('data:')) {
      // Per the SSE spec, strip a single optional leading space after the colon.
      dataLines.push(line.slice(5).replace(/^ /, ''));
    }
  }
  if (dataLines.length === 0) return null;
  return dataLines.join('\n');
}

/** Parse and validate a single SSE frame into a typed AG-UI event. */
export function decodeAgUiEvent(frame: string): AgUiEvent | null {
  const payload = parseSSEFrame(frame);
  if (payload === null) return null;
  const json: unknown = JSON.parse(payload);
  return agUiEventSchema.parse(json);
}

/**
 * Consume an AG-UI SSE byte stream, invoking `onEvent` for each event in order.
 * Resolves on the first terminal event or EOF. Callers decide how to handle
 * EOF without a terminal event.
 */
export async function readAgUiStream(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: AgUiEvent) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let previousChunkEndedWithCr = false;
  let reachedEof = false;

  const dispatch = (chunk: string): boolean => {
    if (chunk === '') return false;
    // A CR already counted as a line ending even if its paired LF arrives later.
    const text = previousChunkEndedWithCr && chunk.startsWith('\n') ? chunk.slice(1) : chunk;
    previousChunkEndedWithCr = chunk.endsWith('\r');
    buffer += text.replace(/\r\n?/g, '\n');
    const frames = buffer.split('\n\n');
    buffer = frames.pop() ?? '';
    for (const frame of frames) {
      const event = decodeAgUiEvent(frame);
      if (event === null) continue;
      onEvent(event);
      if (event.type === 'RUN_FINISHED' || event.type === 'RUN_ERROR') return true;
    }
    return false;
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        reachedEof = true;
        // SSE discards a partial frame at EOF.
        dispatch(decoder.decode());
        return;
      }
      if (dispatch(decoder.decode(value, { stream: true }))) return;
    }
  } finally {
    // A transport may keep the response open after termination or fail while
    // cancelling it. Release the connection without delaying the caller.
    if (!reachedEof) void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
