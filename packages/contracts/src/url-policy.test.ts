import { describe, expect, it } from 'vitest';
import { validateWebhookUrl } from './url-policy.js';

describe('webhook URL policy (SSRF protection)', () => {
  it('accepts ordinary public https destinations', () => {
    expect(validateWebhookUrl('https://hooks.example.com/catch/abc123').ok).toBe(true);
    expect(validateWebhookUrl('https://8.8.8.8/endpoint').ok).toBe(true);
  });

  it('rejects non-http(s) schemes', () => {
    expect(validateWebhookUrl('ftp://example.com/x').ok).toBe(false);
    expect(validateWebhookUrl('file:///etc/passwd').ok).toBe(false);
    expect(validateWebhookUrl('gopher://example.com/').ok).toBe(false);
  });

  it('rejects URLs with embedded credentials', () => {
    expect(validateWebhookUrl('https://user:pass@example.com/').ok).toBe(false);
    expect(validateWebhookUrl('https://user@example.com/').ok).toBe(false);
  });

  it('rejects loopback, private and link-local IPv4 ranges', () => {
    for (const host of [
      '127.0.0.1',
      '10.0.0.5',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.1.1',
      '169.254.169.254',
      '100.64.0.1',
      '0.0.0.0',
    ]) {
      const result = validateWebhookUrl(`http://${host}/`);
      expect(result.ok, `expected ${host} to be rejected`).toBe(false);
    }
  });

  it('rejects IPv6 loopback, link-local and unique-local ranges', () => {
    for (const host of ['[::1]', '[fe80::1]', '[fd00::1234]', '[fc00::1]']) {
      const result = validateWebhookUrl(`http://${host}/`);
      expect(result.ok, `expected ${host} to be rejected`).toBe(false);
    }
  });

  it('rejects IPv4-mapped IPv6 forms of private ranges', () => {
    expect(validateWebhookUrl('http://[::ffff:127.0.0.1]/').ok).toBe(false);
    expect(validateWebhookUrl('http://[::ffff:192.168.0.1]/').ok).toBe(false);
  });

  it('rejects internal hostnames and unparseable URLs', () => {
    expect(validateWebhookUrl('http://localhost:8080/').ok).toBe(false);
    expect(validateWebhookUrl('https://db.internal/').ok).toBe(false);
    expect(validateWebhookUrl('https://printer.local/').ok).toBe(false);
    expect(validateWebhookUrl('not a url').ok).toBe(false);
  });

  it('allows everything when the deployment explicitly opts into private destinations', () => {
    expect(validateWebhookUrl('http://127.0.0.1:8080/', { allowPrivate: true }).ok).toBe(true);
    expect(validateWebhookUrl('http://192.168.1.10/', { allowPrivate: true }).ok).toBe(true);
  });
});
