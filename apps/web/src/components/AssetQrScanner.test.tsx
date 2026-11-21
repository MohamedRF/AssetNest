import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import encodeQr from 'qr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AssetQrScanner } from './AssetQrScanner';

const assetId = '4fcd4f7d-7811-4feb-9ead-56d4ac6e83c9';
const workspaceId = 'fbd2904b-3f09-46fa-8200-1c4fec8bbda6';
const stop = vi.fn();
const getUserMedia = vi.fn<() => Promise<MediaStream>>();
const track = Object.assign(new EventTarget(), { stop });
const camera = { getTracks: () => [track], getVideoTracks: () => [track] } as unknown as MediaStream;

function mockCameraFrame(payload: string) {
  const modules = encodeQr(payload, 'raw', { border: 4, scale: 6 });
  const data = Uint8ClampedArray.from(
    modules.flatMap((row) => row.flatMap((dark) => (dark ? [0, 0, 0, 255] : [255, 255, 255, 255]))),
  );
  const pixels = { data, width: modules.length, height: modules.length };
  const context = { drawImage: vi.fn(), getImageData: () => pixels };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    context as unknown as CanvasRenderingContext2D,
  );
  vi.spyOn(HTMLMediaElement.prototype, 'readyState', 'get').mockReturnValue(2);
  vi.spyOn(HTMLVideoElement.prototype, 'videoWidth', 'get').mockReturnValue(pixels.width);
  vi.spyOn(HTMLVideoElement.prototype, 'videoHeight', 'get').mockReturnValue(pixels.height);
}

describe('Asset QR scanner', () => {
  beforeEach(() => {
    vi.stubGlobal('isSecureContext', true);
    vi.stubGlobal('BarcodeDetector', undefined);
    vi.stubGlobal(
      'navigator',
      Object.assign(Object.create(window.navigator), { mediaDevices: { getUserMedia } }),
    );
    stop.mockClear();
    getUserMedia.mockReset().mockResolvedValue(camera);
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('decodes an asset label without a native barcode detector and stops the rear camera', async () => {
    mockCameraFrame(`${window.location.origin}/asset-qr/${workspaceId}/${assetId}`);
    const onScan = vi.fn();
    render(<AssetQrScanner onScan={onScan} />);

    await userEvent.click(screen.getByRole('button', { name: 'Scan QR' }));

    await waitFor(() => expect(onScan).toHaveBeenCalledExactlyOnceWith({ workspaceId, assetId }));
    expect(getUserMedia).toHaveBeenCalledExactlyOnceWith({
      audio: false,
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } },
    });
    expect(stop).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('keeps the scanner open for an unrecognized QR and stops when closed', async () => {
    mockCameraFrame(`https://another.example/asset-qr/${workspaceId}/${assetId}`);
    const onScan = vi.fn();
    render(<AssetQrScanner onScan={onScan} />);

    await userEvent.click(screen.getByRole('button', { name: 'Scan QR' }));

    expect(await screen.findByText(/does not match an asset label/i)).toBeVisible();
    expect(onScan).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Close scanner' }));
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('stops a camera permission request that completes after the scanner closes', async () => {
    mockCameraFrame(`assetnest://asset/${assetId}`);
    let grantAccess: (stream: MediaStream) => void = () => {
      throw new Error('Camera request has not started');
    };
    getUserMedia.mockImplementation(
      () =>
        new Promise((resolve) => {
          grantAccess = resolve;
        }),
    );
    const onScan = vi.fn();
    render(<AssetQrScanner onScan={onScan} />);

    await userEvent.click(screen.getByRole('button', { name: 'Scan QR' }));
    await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(1));
    await userEvent.click(screen.getByRole('button', { name: 'Close scanner' }));
    grantAccess(camera);

    await waitFor(() => expect(stop).toHaveBeenCalledTimes(1));
    expect(onScan).not.toHaveBeenCalled();
  });

  it('explains how to proceed after camera permission is denied', async () => {
    mockCameraFrame(`assetnest://asset/${assetId}`);
    getUserMedia.mockRejectedValue(new DOMException('Permission denied', 'NotAllowedError'));
    render(<AssetQrScanner onScan={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: 'Scan QR' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/camera access was denied.*code manually/i);
  });

  it('requires a secure context before requesting camera access', async () => {
    vi.stubGlobal('isSecureContext', false);
    render(<AssetQrScanner onScan={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: 'Scan QR' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/needs an HTTPS connection/i);
    expect(getUserMedia).not.toHaveBeenCalled();
  });
});
