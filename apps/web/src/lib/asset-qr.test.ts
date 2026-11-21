import { describe, expect, it } from 'vitest';
import { parseAssetQr } from './asset-qr';

const origin = 'https://inventory.example';
const assetId = '4fcd4f7d-7811-4feb-9ead-56d4ac6e83c9';
const workspaceId = 'fbd2904b-3f09-46fa-8200-1c4fec8bbda6';
const labelPath = `/asset-qr/${workspaceId}/${assetId}`;

describe('parseAssetQr', () => {
  it('accepts a bare asset ID or existing AssetNest label', () => {
    expect(parseAssetQr(` ${assetId.toUpperCase()} `, origin)).toEqual({ assetId });
    expect(parseAssetQr(`assetnest://asset/${assetId}`, origin)).toEqual({ assetId });
  });

  it('returns the workspace for a same-origin asset label', () => {
    expect(parseAssetQr(`${origin}${labelPath}`, origin)).toEqual({ workspaceId, assetId });
  });

  it.each([
    '',
    'assetnest://asset/------------------------------------',
    `https://another.example${labelPath}`,
    `https://inventory.example.another.example${labelPath}`,
    `https://inventory.example@another.example${labelPath}`,
    `${origin}${labelPath}?next=https://another.example`,
    `${origin}${labelPath}#section`,
    `${origin}${labelPath}/edit`,
    `${origin}/asset-qr/not-a-workspace/${assetId}`,
    `javascript:alert('${assetId}')`,
  ])('rejects codes outside the allowed format (%s)', (code) => {
    expect(parseAssetQr(code, origin)).toBeNull();
  });
});
