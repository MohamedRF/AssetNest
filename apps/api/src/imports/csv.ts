/**
 * Small RFC 4180-style CSV parser — no dependencies, streaming not required
 * (imports are capped at a few MB). Handles quoted fields, doubled quotes,
 * commas/newlines inside quotes, CRLF and LF endings, and a leading BOM.
 */

export interface ParsedCsv {
  headers: string[];
  /** Rows aligned to headers; ragged rows are padded/truncated to header length. */
  rows: string[][];
}

export class CsvParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CsvParseError';
  }
}

export function parseCsv(text: string, maxRows = 5000): ParsedCsv {
  const input = text.replace(/^\uFEFF/, '');
  const records: string[][] = [];
  let field = '';
  let record: string[] = [];
  let inQuotes = false;
  let fieldStarted = false;

  const pushField = () => {
    record.push(field);
    field = '';
    fieldStarted = false;
  };
  const pushRecord = () => {
    pushField();
    records.push(record);
    record = [];
  };

  for (let i = 0; i < input.length; i += 1) {
    const ch = input.charAt(i);
    if (inQuotes) {
      if (ch === '"') {
        if (input.charAt(i + 1) === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"' && !fieldStarted) {
      inQuotes = true;
      fieldStarted = true;
      continue;
    }
    if (ch === ',') {
      pushField();
      continue;
    }
    if (ch === '\r') {
      // Tolerate CRLF: swallow the LF that follows.
      if (input.charAt(i + 1) === '\n') i += 1;
      pushRecord();
      continue;
    }
    if (ch === '\n') {
      pushRecord();
      continue;
    }
    field += ch;
    fieldStarted = true;
  }
  if (field.length > 0 || record.length > 0 || inQuotes) {
    if (inQuotes) {
      throw new CsvParseError('Unterminated quoted field in CSV input');
    }
    pushRecord();
  }

  if (records.length === 0) {
    return { headers: [], rows: [] };
  }
  const headers = records[0]!.map((h) => h.trim());
  if (headers.every((h) => h === '')) {
    throw new CsvParseError('CSV header row is empty');
  }
  const width = headers.length;
  const rows = records.slice(1, maxRows + 1).map((row) => {
    const normalized = [...row];
    while (normalized.length < width) normalized.push('');
    return normalized.slice(0, width).map((cell) => cell.trim());
  });
  return { headers, rows };
}
