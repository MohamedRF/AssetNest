const assetIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const legacyPrefix = 'assetnest://asset/';

export interface AssetQrTarget {
  assetId: string;
  workspaceId?: string;
}

export function parseAssetQr(value: string, origin: string): AssetQrTarget | null {
  const raw = value.trim();
  if (assetIdPattern.test(raw)) return { assetId: raw.toLowerCase() };

  if (raw.toLowerCase().startsWith(legacyPrefix)) {
    const id = raw.slice(legacyPrefix.length);
    return assetIdPattern.test(id) ? { assetId: id.toLowerCase() } : null;
  }

  const prefix = `${origin}/asset-qr/`;
  if (!raw.startsWith(prefix)) return null;

  const [workspaceId, assetId, extra] = raw.slice(prefix.length).split('/');
  if (!workspaceId || !assetId || extra !== undefined) return null;
  if (!assetIdPattern.test(workspaceId) || !assetIdPattern.test(assetId)) return null;
  return { workspaceId: workspaceId.toLowerCase(), assetId: assetId.toLowerCase() };
}

export function loginPathFor(pathname: string, origin: string): string {
  const target = parseAssetQr(`${origin}${pathname}`, origin);
  if (!target?.workspaceId) return '/login';
  const query = new URLSearchParams({ qr: `/asset-qr/${target.workspaceId}/${target.assetId}` });
  return `/login?${query}`;
}
