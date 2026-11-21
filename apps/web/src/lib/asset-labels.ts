import { getApiBaseUrl } from './api';

export const MAX_LABELS_PER_BATCH = 100;

export interface LabelAsset {
  id: string;
  assetTag: string;
  displayName: string;
}

export interface AssetLabel extends LabelAsset {
  svg: string;
  imageUrl: string;
}

export function assetQrUrl(workspaceId: string, assetId: string): string {
  return `${getApiBaseUrl()}/workspaces/${encodeURIComponent(workspaceId)}/assets/${encodeURIComponent(assetId)}/qr?format=link`;
}

export function labelImageName(asset: LabelAsset): string {
  const tag = asset.assetTag.replace(/[^a-z0-9_-]/gi, '-').slice(0, 48);
  return `asset-${tag}-${asset.id}.svg`;
}

export function sizeLabelImage(svg: string, size: number): string {
  const document = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const root = document.documentElement;
  if (root.localName !== 'svg' || root.namespaceURI !== 'http://www.w3.org/2000/svg') {
    throw new Error('Invalid QR label image');
  }
  root.setAttribute('width', `${size}mm`);
  root.setAttribute('height', `${size}mm`);
  return new XMLSerializer().serializeToString(root);
}

export async function loadAssetLabels(
  workspaceId: string,
  assets: readonly LabelAsset[],
  signal: AbortSignal,
): Promise<AssetLabel[]> {
  const labels: AssetLabel[] = [];
  for (let index = 0; index < assets.length; index += 6) {
    const batch = await Promise.all(
      assets.slice(index, index + 6).map(async (asset) => {
        const response = await fetch(assetQrUrl(workspaceId, asset.id), {
          credentials: 'include',
          signal,
        });
        if (!response.ok || !response.headers.get('content-type')?.startsWith('image/svg+xml')) {
          throw new Error('A label could not be loaded');
        }
        const svg = await response.text();
        const imageUrl = `data:image/svg+xml,${encodeURIComponent(svg)}`;
        const image = new Image();
        image.src = imageUrl;
        await image.decode();
        return { ...asset, svg, imageUrl };
      }),
    );
    labels.push(...batch);
  }
  return labels;
}

export function downloadLabelFile(file: Blob, filename: string): void {
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
