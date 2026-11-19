import { describe, expect, it } from 'vitest';
import { parseCsv, CsvParseError } from './csv.js';

describe('parseCsv', () => {
  it('parses a simple document', () => {
    const { headers, rows } = parseCsv('assetTag,displayName\nA-1,Laptop\nA-2,"Dock, USB-C"\n');
    expect(headers).toEqual(['assetTag', 'displayName']);
    expect(rows).toEqual([
      ['A-1', 'Laptop'],
      ['A-2', 'Dock, USB-C'],
    ]);
  });

  it('handles CRLF and LF endings identically', () => {
    const lf = parseCsv('a,b\n1,2\n3,4\n');
    const crlf = parseCsv('a,b\r\n1,2\r\n3,4\r\n');
    expect(lf.rows).toEqual(crlf.rows);
  });

  it('handles escaped quotes inside quoted fields', () => {
    const { rows } = parseCsv('note\n"He said ""hi"""\n');
    expect(rows[0]![0]).toBe('He said "hi"');
  });

  it('pads ragged rows to header width and strips a BOM', () => {
    const { rows } = parseCsv('\uFEFFa,b,c\n1,2\n');
    expect(rows[0]).toEqual(['1', '2', '']);
  });

  it('rejects unterminated quotes', () => {
    expect(() => parseCsv('a\n"unterminated\n')).toThrow(CsvParseError);
  });

  it('returns empty headers for empty input', () => {
    expect(parseCsv('')).toEqual({ headers: [], rows: [] });
  });
});
