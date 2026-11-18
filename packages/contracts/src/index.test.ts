import { describe, expect, it } from 'vitest';
import {
  assetQrPayloadSchema,
  assetTagSchema,
  currencySchema,
  listQuerySchema,
  problemDetailsSchema,
} from './index.js';

describe('problemDetailsSchema', () => {
  it('accepts a well-formed problem document', () => {
    const parsed = problemDetailsSchema.parse({
      type: 'about:blank',
      title: 'Not found',
      status: 404,
      code: 'ASSET_NOT_FOUND',
      requestId: 'req_1',
    });
    expect(parsed.status).toBe(404);
  });
});

describe('listQuerySchema', () => {
  it('caps pageSize at 100 and defaults page to 1', () => {
    expect(listQuerySchema.parse({})).toEqual({ page: 1, pageSize: 25 });
    expect(() => listQuerySchema.parse({ pageSize: 500 })).toThrow();
  });
});

describe('assetTagSchema', () => {
  it('normalizes to uppercase', () => {
    expect(assetTagSchema.parse('off-000142')).toBe('OFF-000142');
  });
  it('rejects illegal tags', () => {
    expect(() => assetTagSchema.parse('BAD TAG!')).toThrow();
  });
});

describe('assetQrPayloadSchema / currencySchema', () => {
  it('QR payload carries opaque ids only', () => {
    const ws = crypto.randomUUID();
    const asset = crypto.randomUUID();
    const parsed = assetQrPayloadSchema.parse({
      kind: 'assetnest/asset',
      v: 1,
      workspaceId: ws,
      assetId: asset,
    });
    expect(parsed.kind).toBe('assetnest/asset');
  });
  it('currency must be ISO-4217 style', () => {
    expect(currencySchema.parse('INR')).toBe('INR');
    expect(() => currencySchema.parse('inr')).toThrow();
  });
});
