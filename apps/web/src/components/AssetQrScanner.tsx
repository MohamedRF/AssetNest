import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { ScanLine } from 'lucide-react';
import { parseAssetQr, type AssetQrTarget } from '../lib/asset-qr';
import { Button } from './ui/button';
import { Dialog } from './ui/dialog';

const scannerUnavailable =
  'Live scanning is unavailable in this browser. Use your phone’s Camera app on labels with a web link, or enter the asset tag or code manually.';
const maxFrameDimension = 960;
const scanIntervalMs = 180;

function cameraErrorMessage(error: unknown): string {
  const name = error instanceof DOMException || error instanceof Error ? error.name : '';
  switch (name) {
    case 'NotAllowedError':
      return 'Camera access was denied. Allow camera access in your browser settings or enter the code manually.';
    case 'NotFoundError':
      return 'No camera was found. Enter the asset tag or code manually.';
    case 'NotReadableError':
      return 'The camera could not start. Close other apps using it and reopen the scanner.';
    default:
      return 'The QR scanner could not read the camera. Reopen the scanner or enter the code manually.';
  }
}

export function AssetQrScanner({ onScan }: { onScan: (target: AssetQrTarget) => void }) {
  const [open, setOpen] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unrecognized, setUnrecognized] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const reportScan = useEffectEvent((target: AssetQrTarget) => {
    setOpen(false);
    onScan(target);
  });

  useEffect(() => {
    if (!open || !videoRef.current) return;
    const video = videoRef.current;
    let active = true;
    let stream: MediaStream | undefined;
    let timer: number | undefined;

    function stop() {
      if (!active) return;
      active = false;
      window.clearTimeout(timer);
      stream?.getTracks().forEach((track) => {
        track.removeEventListener('ended', handleTrackEnded);
        track.stop();
      });
      if (video.srcObject === stream) video.srcObject = null;
    }

    function fail(message: string) {
      stop();
      setStarting(false);
      setError(message);
    }

    function handleTrackEnded() {
      if (active) fail('The camera stopped. Reopen the scanner or enter the code manually.');
    }

    function handlePageHide() {
      stop();
      setOpen(false);
    }

    async function scan(readFrame: () => Promise<ReadonlyArray<{ rawValue: string }>>) {
      try {
        if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth && video.videoHeight) {
          const codes = await readFrame();
          if (!active) return;
          for (const code of codes) {
            const target = parseAssetQr(code.rawValue, window.location.origin);
            if (target) {
              stop();
              reportScan(target);
              return;
            }
          }
          if (codes.length) setUnrecognized(true);
        }
        timer = window.setTimeout(() => void scan(readFrame), scanIntervalMs);
      } catch (cause) {
        if (active) fail(cameraErrorMessage(cause));
      }
    }

    async function start() {
      try {
        if (!window.isSecureContext) {
          fail('Camera scanning needs an HTTPS connection. Open the secure site or enter the code manually.');
          return;
        }
        if (!navigator.mediaDevices?.getUserMedia) {
          fail(scannerUnavailable);
          return;
        }
        const frame = document.createElement('canvas');
        const context = frame.getContext('2d', { willReadFrequently: true });
        if (!context) {
          fail(scannerUnavailable);
          return;
        }

        const { BarcodeDetector } = await import('qr/decode.js');
        if (!active) return;
        const detector = new BarcodeDetector({ formats: ['qr_code'] });
        const camera = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } },
        });
        if (!active) {
          camera.getTracks().forEach((track) => track.stop());
          return;
        }
        stream = camera;
        for (const track of camera.getVideoTracks()) {
          track.addEventListener('ended', handleTrackEnded);
        }
        video.srcObject = camera;
        await video.play();
        if (!active) return;
        setStarting(false);
        void scan(() => {
          const scale = Math.min(1, maxFrameDimension / Math.max(video.videoWidth, video.videoHeight));
          const width = Math.max(1, Math.round(video.videoWidth * scale));
          const height = Math.max(1, Math.round(video.videoHeight * scale));
          if (frame.width !== width) frame.width = width;
          if (frame.height !== height) frame.height = height;
          context.drawImage(video, 0, 0, width, height);
          return detector.detect(frame);
        });
      } catch (cause) {
        if (active) fail(cameraErrorMessage(cause));
      }
    }

    window.addEventListener('pagehide', handlePageHide);
    void start();
    return () => {
      window.removeEventListener('pagehide', handlePageHide);
      stop();
    };
  }, [open]);

  return (
    <>
      <Button
        variant="outline"
        onClick={() => {
          setStarting(true);
          setError(null);
          setUnrecognized(false);
          setOpen(true);
        }}
      >
        <ScanLine aria-hidden="true" className="h-4 w-4" />
        Scan QR
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Scan an asset QR code"
        description="Point your camera at an AssetNest QR label. Camera frames stay on this device."
        footer={
          <Button variant="outline" onClick={() => setOpen(false)}>
            Close scanner
          </Button>
        }
      >
        <video
          ref={videoRef}
          aria-hidden="true"
          playsInline
          muted
          hidden={!open || starting || error !== null}
          className="aspect-video w-full rounded-lg bg-black object-contain"
        />
        {starting && <p role="status">Waiting for camera access…</p>}
        {error && <p role="alert">{error}</p>}
        {!error && unrecognized && (
          <p role="status" className="mt-2 text-muted-foreground">
            This code does not match an asset label for this site. Try another code.
          </p>
        )}
      </Dialog>
    </>
  );
}
