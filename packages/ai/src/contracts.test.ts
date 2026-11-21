import { describe, expect, it } from 'vitest';
import {
  assetFilterSchema,
  canRunTask,
  capabilitySchema,
  invoiceDraftSchema,
  photoDraftSchema,
  unverifiedCapabilities,
} from './index.js';

describe('AI task contracts', () => {
  it('requires verified model capabilities', () => {
    const model = capabilitySchema.parse(unverifiedCapabilities());
    model.features.text = 'supported';
    expect(canRunTask('asset_chat', model)).toBe(true);
    expect(canRunTask('invoice_extraction', model)).toBe(false);
    model.features.structured_output = 'supported';
    expect(canRunTask('invoice_extraction', model)).toBe(true);
    expect(canRunTask('image_tagging', model)).toBe(false);
  });

  it('rejects executable and ambiguous search filters', () => {
    const status = { field: 'status', operator: 'equals', value: 'available' };
    expect(assetFilterSchema.safeParse({ filters: [status] }).success).toBe(true);
    expect(assetFilterSchema.safeParse({ filters: [status, status] }).success).toBe(false);
    expect(assetFilterSchema.safeParse({ filters: [], sql: 'SELECT 1' }).success).toBe(false);
    expect(
      assetFilterSchema.safeParse({ filters: [{ field: 'workspaceId', operator: 'equals', value: 'other' }] })
        .success,
    ).toBe(false);
  });

  it('validates proposals as bounded drafts with unknown values represented explicitly', () => {
    const draft = {
      vendor: null,
      invoiceNo: null,
      purchaseDate: '2026-11-19',
      currency: 'INR',
      items: [
        {
          name: 'Laptop',
          model: null,
          serialNumber: '000024',
          price: '500.00',
          warrantyEndsOn: null,
          confidence: 0.8,
          evidence: null,
        },
      ],
    };
    expect(invoiceDraftSchema.parse(draft).items[0]?.serialNumber).toBe('000024');
    expect(invoiceDraftSchema.safeParse({ ...draft, approved: true }).success).toBe(false);
    expect(
      photoDraftSchema.safeParse({
        category: null,
        model: null,
        visibleSerial: { value: '007' },
        confidence: 1,
      }).success,
    ).toBe(false);
  });
});
