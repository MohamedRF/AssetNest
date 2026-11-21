import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { Download, Printer } from 'lucide-react';
import type { OperationOptions, OperationResult } from '@assetnest/sdk';
import { api, isApiError } from '../lib/api';
import {
  downloadLabelFile,
  labelImageName,
  loadAssetLabels,
  sizeLabelImage,
  type LabelAsset,
} from '../lib/asset-labels';
import { zipTextFiles } from '../lib/zip';
import { Button } from './ui/button';
import { Dialog } from './ui/dialog';
import { Input } from './ui/input';

export function AssetLabelsDialog({
  workspaceId,
  assets,
  canExport,
  onClose,
}: {
  workspaceId: string;
  assets: readonly LabelAsset[];
  canExport: boolean;
  onClose: () => void;
}) {
  const [size, setSize] = useState('35');
  const [includeNames, setIncludeNames] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(false);
  const sizeMm = Number(size);
  const validSize = /^\d+$/.test(size) && sizeMm >= 20 && sizeMm <= 100;
  const assetIds = assets.map((asset) => asset.id);
  const images = useQuery({
    queryKey: ['asset-label-images', workspaceId, assets],
    queryFn: ({ signal }) => loadAssetLabels(workspaceId, assets, signal),
    gcTime: 0,
    retry: false,
  });
  const ready = validSize && !!images.data?.length && !exporting && !images.isError;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  async function downloadZip() {
    if (!ready || !images.data || !canExport) return;
    setExporting(true);
    setError(null);
    try {
      const body: OperationOptions<'getAssetLabelExport'>['body'] = { assetIds };
      const { items } = await api.post<OperationResult<'getAssetLabelExport'>>(
        `/workspaces/${encodeURIComponent(workspaceId)}/assets/qr-label-export`,
        body,
      );
      if (!mounted.current) return;
      const files = images.data.map((label) => ({
        name: labelImageName(label),
        contents: sizeLabelImage(label.svg, sizeMm),
      }));
      const imageNames = new Map(images.data.map((label) => [label.id, labelImageName(label)]));
      files.push({
        name: 'asset-details.json',
        contents: JSON.stringify(
          items.map((item) => ({ ...item, qrImage: imageNames.get(item.id) })),
          null,
          2,
        ),
      });
      downloadLabelFile(zipTextFiles(files), 'assetnest-qr-labels.zip');
    } catch (failure) {
      if (mounted.current) {
        setError(isApiError(failure) ? failure.detail : 'Could not download the ZIP. Please try again.');
      }
    } finally {
      if (mounted.current) setExporting(false);
    }
  }

  function downloadSingleImage() {
    const label = images.data?.[0];
    if (!ready || !label) return;
    try {
      const svg = sizeLabelImage(label.svg, sizeMm);
      downloadLabelFile(new Blob([svg], { type: 'image/svg+xml' }), labelImageName(label));
    } catch {
      setError('Could not download the image. Please try again.');
    }
  }

  return (
    <>
      <Dialog
        open
        onClose={onClose}
        title={assets.length === 1 ? 'QR label' : `QR labels for ${assets.length} assets`}
        description="Print at 100% or Actual size to keep the selected QR dimensions."
        footer={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={onClose}>
              Close
            </Button>
            {assets.length === 1 && (
              <Button variant="outline" disabled={!ready} onClick={downloadSingleImage}>
                <Download aria-hidden="true" className="h-4 w-4" /> SVG
              </Button>
            )}
            {canExport && (
              <Button variant="outline" disabled={!ready} onClick={() => void downloadZip()}>
                <Download aria-hidden="true" className="h-4 w-4" />
                {exporting ? 'Preparing ZIP…' : 'ZIP with details'}
              </Button>
            )}
            <Button disabled={!ready} onClick={() => window.print()}>
              <Printer aria-hidden="true" className="h-4 w-4" /> Print
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          <label className="flex w-fit flex-wrap items-center gap-2">
            <span>QR width and height (mm)</span>
            <Input
              type="number"
              min={20}
              max={100}
              step={1}
              inputMode="numeric"
              className="w-24"
              value={size}
              disabled={exporting}
              aria-invalid={!validSize}
              onChange={(event) => setSize(event.target.value)}
            />
          </label>
          {!validSize && (
            <p role="alert" className="text-danger">
              Enter a whole number from 20 to 100 mm.
            </p>
          )}
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={includeNames}
              onChange={(event) => setIncludeNames(event.target.checked)}
            />
            Print the asset name and tag below each code
          </label>
          {images.isLoading && <p role="status">Preparing label images…</p>}
          {images.isError && (
            <p role="alert" className="text-danger">
              Could not prepare every label.{' '}
              <button type="button" className="underline" onClick={() => void images.refetch()}>
                Retry
              </button>
            </p>
          )}
          {error && (
            <p role="alert" className="text-danger">
              {error}
            </p>
          )}
          {canExport && (
            <p className="text-muted-foreground">
              The ZIP includes private asset details. Share it with people who have permission to see them.
            </p>
          )}
        </div>
      </Dialog>
      {validSize &&
        images.data &&
        createPortal(
          <section className="asset-label-print" aria-label="Asset QR labels">
            {images.data.map((label) => (
              <figure className="asset-label" key={label.id} style={{ width: `${sizeMm}mm` }}>
                <img
                  src={label.imageUrl}
                  alt={`QR code for ${label.assetTag}`}
                  style={{ width: `${sizeMm}mm`, height: `${sizeMm}mm` }}
                />
                {includeNames && (
                  <figcaption>
                    <strong>{label.assetTag}</strong>
                    <br />
                    {label.displayName}
                  </figcaption>
                )}
              </figure>
            ))}
          </section>,
          document.body,
        )}
    </>
  );
}
