/** Magic-byte content sniffing for the upload allowlist. Never trust the declared MIME alone. */

export type SniffedMime = 'application/pdf' | 'image/png' | 'image/jpeg' | 'image/webp' | 'text/plain';

export function sniffMime(buffer: Buffer): SniffedMime | null {
  if (buffer.length >= 5 && buffer.subarray(0, 5).toString('latin1') === '%PDF-') {
    return 'application/pdf';
  }
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 && // P
    buffer[2] === 0x4e && // N
    buffer[3] === 0x47 && // G
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a
  ) {
    return 'image/png';
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('latin1') === 'RIFF' &&
    buffer.subarray(8, 12).toString('latin1') === 'WEBP'
  ) {
    return 'image/webp';
  }
  if (looksLikePrintableUtf8(buffer)) {
    return 'text/plain';
  }
  return null;
}

function looksLikePrintableUtf8(buffer: Buffer): boolean {
  if (buffer.length === 0) {
    return false;
  }
  try {
    // Throws on invalid UTF-8 sequences; also reject control chars other than tab/LF/CR.
    const text = new TextDecoder('utf-8', { fatal: true }).decode(
      buffer.subarray(0, Math.min(buffer.length, 8192)),
    );
    for (const ch of text) {
      const code = ch.codePointAt(0) ?? 0;
      const isAllowedControl = code === 0x09 || code === 0x0a || code === 0x0d;
      const isPrintable = code >= 0x20 || isAllowedControl;
      if (!isPrintable || code === 0x7f) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

/** The declared mimetype must equal the sniffed type (or be a generic binary for text). */
export function declaredMatchesSniffed(declared: string, sniffed: SniffedMime): boolean {
  const normalized = declared.toLowerCase().split(';')[0]!.trim();
  if (normalized === sniffed) {
    return true;
  }
  // For plain text, browsers may declare application/octet-stream or text/csv.
  if (sniffed === 'text/plain' && (normalized === 'application/octet-stream' || normalized === 'text/csv')) {
    return true;
  }
  return false;
}

/** Display-safe filename for Content-Disposition (RFC 5987 + ASCII fallback). */
export function contentDispositionFilename(name: string): { ascii: string; encoded: string } {
  const base = name.replace(/[\\/\r\n"]/g, '_').slice(-120) || 'download';
  const ascii = base.replace(/[^\x20-\x7e]/g, '_');
  const encoded = encodeURIComponent(base).replace(/'/g, '%27');
  return { ascii, encoded };
}
