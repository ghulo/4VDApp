import { Camera } from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';
import { useT } from '../i18n/useT';
import { codeFromScan } from '../utils/scanLinks';
import { Button, Sheet } from './ui';

/** Product barcodes, the Code 128 some suppliers print, and the shop's own QR codes. */
const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'qr_code'];
const SCAN_EVERY_MS = 200;
const SAME_CODE_PAUSE_MS = 1500;
/** Frames are scaled down to this width before decoding: sharp enough for a label, quick on a phone. */
const MAX_FRAME_WIDTH = 1280;
interface Detector {
  detect(source: ImageData): Promise<Array<{ rawValue: string }>>;
}

/** The browser's own barcode reader where there is one (Chrome on Android), otherwise the bundled one (Safari on iPhone). */
async function createDetector(): Promise<Detector> {
  const Native = (globalThis as { BarcodeDetector?: { new (options: { formats: string[] }): Detector; getSupportedFormats(): Promise<string[]> } })
    .BarcodeDetector;
  if (Native) {
    const supported = await Native.getSupportedFormats();
    if (FORMATS.every((format) => supported.includes(format))) return new Native({ formats: FORMATS });
  }
  const { BarcodeDetector, setZXingModuleOverrides } = await import('barcode-detector/ponyfill');
  // The decoder is served from the dashboard itself (copied there on install), not from a CDN.
  setZXingModuleOverrides({ locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? `/zxing/${path}` : prefix + path) });
  return new BarcodeDetector({ formats: FORMATS as never });
}

/**
 * The phone or laptop camera as a barcode scanner. Each frame is drawn onto a
 * canvas and decoded: the one way that works the same in every browser,
 * Safari on iPhone included. `onScan` gets each new code once.
 */
export function CameraView({ onScan }: { onScan: (code: string) => void }) {
  const t = useT();
  const video = useRef<HTMLVideoElement>(null);
  const onScanRef = useRef(onScan);
  useEffect(() => {
    onScanRef.current = onScan;
  });
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let stopped = false;
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let last: { code: string; at: number } | null = null;
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d', { willReadFrequently: true });

    async function start() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        });
      } catch (error) {
        setProblem((error as Error).name === 'NotAllowedError' ? t.staff.camera.denied : t.staff.camera.failed((error as Error).message));
        return;
      }
      if (stopped || !video.current) return stream.getTracks().forEach((track) => track.stop());
      video.current.srcObject = stream;
      await video.current.play().catch(() => undefined);

      let detector: Detector;
      try {
        detector = await createDetector();
      } catch (error) {
        setProblem(t.staff.camera.readFailed((error as Error).message));
        return;
      }

      const scan = async () => {
        if (stopped) return;
        const element = video.current;
        if (element && context && element.readyState >= element.HAVE_CURRENT_DATA && element.videoWidth > 0) {
          const scale = Math.min(1, MAX_FRAME_WIDTH / element.videoWidth);
          canvas.width = Math.round(element.videoWidth * scale);
          canvas.height = Math.round(element.videoHeight * scale);
          context.drawImage(element, 0, 0, canvas.width, canvas.height);
          try {
            for (const result of await detector.detect(context.getImageData(0, 0, canvas.width, canvas.height))) {
              const code = codeFromScan(result.rawValue);
              const now = Date.now();
              if (last && last.code === code && now - last.at < SAME_CODE_PAUSE_MS) continue;
              last = { code, at: now };
              onScanRef.current(code);
            }
            setProblem(null);
          } catch (error) {
            setProblem(t.staff.camera.readFailed((error as Error).message));
          }
        }
        timer = setTimeout(scan, SCAN_EVERY_MS);
      };
      void scan();
    }

    void start();
    return () => {
      stopped = true;
      clearTimeout(timer);
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [t]);

  return (
    <div className="camera-view">
      {/* playsInline keeps iPhone Safari from opening the camera full screen. */}
      <video ref={video} className="camera-view__video" playsInline muted autoPlay aria-label={t.staff.camera.title} />
      <p className={problem ? 'camera-view__hint camera-view__hint--problem' : 'camera-view__hint'} role="status">
        {problem ?? t.staff.camera.hint}
      </p>
    </div>
  );
}

/**
 * A "Scan with the camera" key that opens the camera in a panel; the first
 * code read closes it and goes to `onScan`. For phones without a USB scanner.
 */
export function CameraScanButton({ onScan, label, size, iconOnly }: { onScan: (code: string) => void; label?: string; size?: 'sm' | 'md'; iconOnly?: boolean }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const text = label ?? t.staff.camera.open;
  return (
    <>
      <Button icon={Camera} size={size} onClick={() => setOpen(true)} aria-label={iconOnly ? text : undefined} title={iconOnly ? text : undefined}>
        {iconOnly ? undefined : text}
      </Button>
      <Sheet open={open} onClose={() => setOpen(false)} title={t.staff.camera.title}>
        {open && (
          <CameraView
            onScan={(code) => {
              setOpen(false);
              onScan(code);
            }}
          />
        )}
      </Sheet>
    </>
  );
}
